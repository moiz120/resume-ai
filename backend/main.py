import os
import io
import json
import tempfile

from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import PyPDF2
from sqlalchemy.orm import Session

load_dotenv()

from groq import Groq
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

from models.database import get_db, Base, engine
from models.models import UserUsage, ResumeAnalysis

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Resume AI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Admin IPs get unlimited access
ADMIN_IPS = ["127.0.0.1", "localhost", "::1"]

class AnalyzeRequest(BaseModel):
    resume_text: str
    job_description: str

class RewriteRequest(BaseModel):
    section_type: str
    original_text: str
    job_description: str

class PDFRequest(BaseModel):
    content: str
    template: str = "modern"

def get_user_id(request: Request, authorization: str = Header(None)) -> str:
    """Get user_id from Clerk token, or fallback to IP for guests"""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "")
        try:
            from clerk_backend_api import Clerk
            clerk = Clerk(bearer_auth=os.getenv("CLERK_SECRET_KEY"))
            jwt_payload = clerk.verify_token(token)
            return f"user_{jwt_payload.get('sub')}"
        except:
            pass
    return f"ip_{request.client.host}"

def check_limit(user_id: str, db: Session):
    """Check usage limits per user (or IP)"""
    from datetime import datetime, timedelta

    # Admin bypass for localhost
    if user_id.startswith("ip_127.0.0.1") or user_id.startswith("ip_localhost") or user_id.startswith("ip_::1"):
        return {"allowed": True, "remaining": 999, "is_pro": True}

    now = datetime.utcnow()
    reset_time = now + timedelta(days=1)

    usage = db.query(UserUsage).filter(UserUsage.client_ip == user_id).first()

    if not usage:
        usage = UserUsage(client_ip=user_id, count=1, reset_time=reset_time)
        db.add(usage)
        db.commit()
        return {"allowed": True, "remaining": 2, "is_pro": False}

    if now > usage.reset_time:
        usage.count = 1
        usage.reset_time = reset_time
        db.commit()
        return {"allowed": True, "remaining": 2, "is_pro": False}

    # TODO: Add is_pro field to database model for paid users
    is_pro = getattr(usage, 'is_pro', False)

    if is_pro:
        return {"allowed": True, "remaining": 999, "is_pro": True}

    if usage.count >= 3:
        return {"allowed": False, "remaining": 0, "is_pro": False}

    usage.count += 1
    db.commit()
    return {"allowed": True, "remaining": max(0, 3 - usage.count), "is_pro": False}

def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    pdf_file = io.BytesIO(pdf_bytes)
    reader = PyPDF2.PdfReader(pdf_file)
    text = ""
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n"
    return text.strip()

@app.post("/api/extract-pdf")
async def extract_pdf(
    file: UploadFile = File(...),
    request: Request = None,
    authorization: str = Header(None)
):
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files allowed")

    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")

    text = extract_text_from_pdf(contents)
    if len(text) < 50:
        raise HTTPException(status_code=400, detail="Could not extract text from PDF.")

    return {"text": text, "length": len(text)}

@app.post("/api/analyze")
async def analyze_resume(
    data: AnalyzeRequest,
    request: Request,
    authorization: str = Header(None),
    db: Session = Depends(get_db)
):
    user_id = get_user_id(request, authorization)
    limit = check_limit(user_id, db)

    if not limit["allowed"]:
        raise HTTPException(status_code=429, detail="Free limit reached. Upgrade to Pro.")

    system_prompt = """You are an expert ATS resume scanner. Return ONLY JSON:
{"overall_score":0-100,"keyword_match":0-100,"formatting_score":0-100,"missing_skills":[],"strengths":[],"improvements":[],"summary":"2-3 sentences"}"""

    user_prompt = f"""RESUME:\n{data.resume_text[:4000]}\n\nJOB DESCRIPTION:\n{data.job_description[:4000]}\n\nReturn JSON only."""

    try:
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_prompt}],
            temperature=0.3, max_tokens=1500
        )
        result_text = response.choices[0].message.content.strip()
        for prefix in ["```json", "```"]:
            if result_text.startswith(prefix): result_text = result_text[len(prefix):]
        if result_text.endswith("```"): result_text = result_text[:-3]
        result_text = result_text.strip()
        result = json.loads(result_text)

        defaults = {"overall_score":50,"keyword_match":50,"formatting_score":50,"missing_skills":[],"strengths":[],"improvements":[],"summary":"Analysis completed."}
        for k,v in defaults.items():
            if k not in result: result[k]=v

        analysis = ResumeAnalysis(
            client_ip=user_id, resume_text=data.resume_text[:2000], job_description=data.job_description[:2000],
            overall_score=result["overall_score"], keyword_match=result["keyword_match"], formatting_score=result["formatting_score"],
            missing_skills=json.dumps(result["missing_skills"]), strengths=json.dumps(result["strengths"]),
            improvements=json.dumps(result["improvements"]), summary=result["summary"]
        )
        db.add(analysis); db.commit()

        result["remaining_uses"] = limit["remaining"]
        result["is_pro"] = limit["is_pro"]
        return result
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.post("/api/rewrite")
async def rewrite_section(
    data: RewriteRequest,
    request: Request,
    authorization: str = Header(None),
    db: Session = Depends(get_db)
):
    """Generate a DENSE 1-page resume that FILLS the entire page"""
    user_id = get_user_id(request, authorization)
    limit = check_limit(user_id, db)

    if not limit["allowed"]:
        raise HTTPException(status_code=429, detail="Free limit reached. Upgrade to Pro.")

    system_prompt = """You are an expert ATS resume writer. Your task: rewrite the user's resume to be professional, keyword-optimized, and DENSE enough to fill ONE FULL PAGE.

CRITICAL RULES — NO EXCEPTIONS:
1. ONLY use real companies, titles, dates, degrees, schools from the original resume
2. NEVER invent metrics — use only real numbers or omit entirely
3. Extract REAL name and contact info from the original header
4. MUST produce 450-550 words to fill the entire page
5. NO blank lines between sections
6. EXPAND descriptions: 4-6 bullets per job, 2-3 sentences per project
7. Skills: inline comma-separated categories, NOT bullet lists
8. Education: include relevant coursework if it fills space
9. EVERY section must be substantive — no one-liners

OUTPUT FORMAT:
# [REAL FULL NAME]
**[City, ST] | [Phone] | [Email] | [LinkedIn]**

## Professional Summary
[4-5 substantial sentences. Cover: years of experience, key technical skills, domain expertise, and career objective. Be specific and detailed.]

## Skills
**Languages:** [List all from original, comma-separated]
**Frameworks & Libraries:** [List all from original]
**Tools & Platforms:** [List all from original]
**Databases & Cloud:** [List all from original]
**AI/ML:** [List all from original]

## Professional Experience

### [Job Title]
**[Company]** | [Location]
*[Start Date] – [End Date]*
- [Detailed bullet: strong action verb + specific task + technology used + measurable outcome if available]
- [Another detailed bullet with different angle]
- [Another detailed bullet]
- [Another detailed bullet — describe challenges faced and solutions implemented]
- [Another detailed bullet — mention collaboration, leadership, or mentoring]
- [Another detailed bullet — mention optimization, performance improvements, or cost savings]

### [Previous Job Title]
**[Company]** | [Location]
*[Start Date] – [End Date]*
- [4-6 detailed bullets, same depth as above]

## Projects

### [Project Name]
**Tech Stack:** [List technologies]
- [2-3 sentences describing the project, your role, technical challenges, and outcomes]
- [Another sentence about impact, users, or performance]

### [Another Project]
**Tech Stack:** [List technologies]
- [2-3 sentences describing the project]

## Education
**[Degree]** in [Major]
[University Name], [Location]
*[Graduation Date]*
- [Relevant coursework: list 3-4 courses]
- [GPA if > 3.5]
- [Honors, Dean's List, scholarships if applicable]

## Certifications
- [Certification Name] — [Issuing Organization], [Year]
- [Another certification if available]

## Additional Information
- [Languages spoken]
- [Open source contributions]
- [Hackathons or competitions]
- [Professional affiliations]

WORD COUNT TARGET: 450-550 words. FILL THE ENTIRE PAGE. Do not stop at 300 words. Keep going until the page is substantively full."""

    user_prompt = f"""TARGET JOB DESCRIPTION (for keyword alignment):
{data.job_description[:2000]}

MY ORIGINAL RESUME — ONLY SOURCE OF TRUTH:
{data.original_text[:5000]}

Rewrite to be ATS-optimized and COMPREHENSIVE. Use ONLY my real info. Target 450-550 words. Fill the entire page. Every section must be substantive. Do not leave half the page blank."""

    try:
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role":"system","content":system_prompt},{"role":"user","content":user_prompt}],
            temperature=0.4, max_tokens=2500
        )
        rewritten = response.choices[0].message.content.strip()
        return {"original": data.original_text, "rewritten": rewritten, "section_type": data.section_type}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rewrite failed: {str(e)}")

@app.post("/api/generate-pdf")
async def generate_pdf(data: PDFRequest):
    """Generate PDF with TRULY DISTINCT professional layouts"""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, HRFlowable, 
            Table, TableStyle, KeepInFrame
        )
        from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
        from reportlab.lib.colors import HexColor, white, black, Color

        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
            tmp_path = tmp.name

        lines = [l.strip() for l in data.content.split('\n') if l.strip()]

        # 5 RADICALLY DIFFERENT TEMPLATES
        TEMPLATES = {
            "modern": {
                "layout": "centered",
                "font_name": 'Helvetica-Bold',
                "font_normal": 'Helvetica',
                "name_align": TA_CENTER,
                "contact_align": TA_CENTER,
                "section_align": TA_LEFT,
                "name_size": 22,
                "contact_size": 9.5,
                "section_size": 11,
                "job_size": 10.5,
                "body_size": 9.5,
                "line_spacing": 11.5,
                "section_space": 8,
                "margin_top": 0.45,
                "margin_sides": 0.65,
                "page_bg": HexColor('#ffffff'),
                "name_color": HexColor('#1e3a5f'),
                "accent_color": HexColor('#2563eb'),
                "text_color": HexColor('#1f2937'),
                "secondary": HexColor('#6b7280'),
                "section_line": True,
                "header_band": False,
                "two_col_skills": False,
                "bullet_indent": 10,
            },
            "classic": {
                "layout": "traditional",
                "font_name": 'Times-Bold',
                "font_normal": 'Times-Roman',
                "name_align": TA_LEFT,
                "contact_align": TA_LEFT,
                "section_align": TA_LEFT,
                "name_size": 18,
                "contact_size": 10,
                "section_size": 11,
                "job_size": 10.5,
                "body_size": 10,
                "line_spacing": 12.5,
                "section_space": 10,
                "margin_top": 0.55,
                "margin_sides": 0.75,
                "page_bg": HexColor('#ffffff'),
                "name_color": HexColor('#000000'),
                "accent_color": HexColor('#2c5282'),
                "text_color": HexColor('#1a202c'),
                "secondary": HexColor('#4a5568'),
                "section_line": True,
                "header_band": False,
                "two_col_skills": False,
                "bullet_indent": 12,
            },
            "minimal": {
                "layout": "ultra_compact",
                "font_name": 'Helvetica-Bold',
                "font_normal": 'Helvetica',
                "name_align": TA_CENTER,
                "contact_align": TA_CENTER,
                "section_align": TA_CENTER,
                "name_size": 24,
                "contact_size": 8.5,
                "section_size": 9,
                "job_size": 9.5,
                "body_size": 8.5,
                "line_spacing": 10,
                "section_space": 5,
                "margin_top": 0.35,
                "margin_sides": 0.5,
                "page_bg": HexColor('#ffffff'),
                "name_color": HexColor('#171717'),
                "accent_color": HexColor('#404040'),
                "text_color": HexColor('#262626'),
                "secondary": HexColor('#525252'),
                "section_line": False,
                "header_band": False,
                "two_col_skills": False,
                "bullet_indent": 8,
            },
            "tech": {
                "layout": "sidebar_skills",
                "font_name": 'Helvetica-Bold',
                "font_normal": 'Helvetica',
                "name_align": TA_LEFT,
                "contact_align": TA_LEFT,
                "section_align": TA_LEFT,
                "name_size": 20,
                "contact_size": 9,
                "section_size": 10,
                "job_size": 10,
                "body_size": 9,
                "line_spacing": 11,
                "section_space": 7,
                "margin_top": 0.4,
                "margin_sides": 0.55,
                "page_bg": HexColor('#f8fafc'),
                "name_color": HexColor('#0f172a'),
                "accent_color": HexColor('#0891b2'),
                "text_color": HexColor('#334155'),
                "secondary": HexColor('#64748b'),
                "section_line": True,
                "header_band": False,
                "two_col_skills": True,
                "bullet_indent": 10,
            },
            "executive": {
                "layout": "dense_header",
                "font_name": 'Helvetica-Bold',
                "font_normal": 'Helvetica',
                "name_align": TA_CENTER,
                "contact_align": TA_CENTER,
                "section_align": TA_LEFT,
                "name_size": 16,
                "contact_size": 8.5,
                "section_size": 9,
                "job_size": 9.5,
                "body_size": 8.5,
                "line_spacing": 10,
                "section_space": 4,
                "margin_top": 0.3,
                "margin_sides": 0.5,
                "page_bg": HexColor('#ffffff'),
                "name_color": HexColor('#1e293b'),
                "accent_color": HexColor('#b45309'),
                "text_color": HexColor('#334155'),
                "secondary": HexColor('#64748b'),
                "section_line": True,
                "header_band": True,
                "two_col_skills": False,
                "bullet_indent": 8,
            }
        }

        t = TEMPLATES.get(data.template, TEMPLATES["modern"])

        doc = SimpleDocTemplate(
            tmp_path,
            pagesize=letter,
            rightMargin=t["margin_sides"]*inch,
            leftMargin=t["margin_sides"]*inch,
            topMargin=t["margin_top"]*inch,
            bottomMargin=0.35*inch
        )

        styles = getSampleStyleSheet()

        # Styles
        name_style = ParagraphStyle(
            'Name', parent=styles['Heading1'],
            fontSize=t["name_size"], textColor=t["name_color"],
            spaceAfter=2, alignment=t["name_align"],
            fontName=t["font_name"], leading=t["name_size"]+2
        )

        contact_style = ParagraphStyle(
            'Contact', parent=styles['Normal'],
            fontSize=t["contact_size"], textColor=t["secondary"],
            spaceAfter=6, alignment=t["contact_align"],
            fontName=t["font_normal"], leading=t["contact_size"]+2
        )

        section_style = ParagraphStyle(
            'Section', parent=styles['Heading2'],
            fontSize=t["section_size"], textColor=t["accent_color"],
            spaceAfter=2, spaceBefore=t["section_space"],
            fontName=t["font_name"], leading=t["section_size"]+2,
            alignment=t["section_align"]
        )

        job_style = ParagraphStyle(
            'Job', parent=styles['Heading3'],
            fontSize=t["job_size"], textColor=t["text_color"],
            spaceAfter=1, spaceBefore=3,
            fontName=t["font_name"], leading=t["job_size"]+1
        )

        company_style = ParagraphStyle(
            'Company', parent=styles['Normal'],
            fontSize=t["contact_size"], textColor=t["secondary"],
            spaceAfter=1, fontName=t["font_normal"],
            leading=t["contact_size"]+1
        )

        date_style = ParagraphStyle(
            'Date', parent=styles['Normal'],
            fontSize=t["contact_size"]-0.5, textColor=t["secondary"],
            spaceAfter=2, fontName=t["font_normal"],
            leading=t["contact_size"]+1
        )

        bullet_style = ParagraphStyle(
            'Bullet', parent=styles['Normal'],
            fontSize=t["body_size"], textColor=t["text_color"],
            leftIndent=t["bullet_indent"], spaceAfter=1,
            fontName=t["font_normal"], leading=t["line_spacing"]
        )

        normal_style = ParagraphStyle(
            'Normal', parent=styles['Normal'],
            fontSize=t["body_size"], textColor=t["text_color"],
            spaceAfter=1, fontName=t["font_normal"],
            leading=t["line_spacing"]
        )

        summary_style = ParagraphStyle(
            'Summary', parent=styles['Normal'],
            fontSize=t["body_size"], textColor=t["text_color"],
            spaceAfter=3, fontName=t["font_normal"],
            leading=t["line_spacing"], alignment=TA_LEFT
        )

        # Build content
        story = []
        skills_data = []
        in_skills = False
        current_section = None

        for i, line in enumerate(lines):
            # Name
            if line.startswith('# ') and not line.startswith('## '):
                story.append(Paragraph(line.replace('# ', ''), name_style))

            # Contact
            elif line.startswith('**') and '|' in line and not line.startswith('##'):
                story.append(Paragraph(line.replace('**','').replace('*',''), contact_style))
                if t["header_band"]:
                    story.append(HRFlowable(width="100%", thickness=2, color=t["accent_color"]))
                    story.append(Spacer(1, 4))

            # Section
            elif line.startswith('## '):
                section_name = line.replace('## ', '').strip()
                current_section = section_name.lower()
                in_skills = 'skill' in current_section

                if t["section_line"]:
                    story.append(Spacer(1, t["section_space"]))
                    story.append(Paragraph(
                        section_name.upper() if t["layout"] == "dense_header" else section_name, 
                        section_style
                    ))
                    story.append(HRFlowable(width="100%", thickness=1, color=t["accent_color"]))
                    story.append(Spacer(1, 2))
                else:
                    story.append(Spacer(1, t["section_space"]))
                    story.append(Paragraph(section_name, section_style))
                    story.append(Spacer(1, 1))

            # Summary
            elif current_section == 'professional summary' and not line.startswith('#'):
                if not line.startswith('**'):
                    story.append(Paragraph(line, summary_style))

            # Skills — collect for table layout
            elif in_skills and line.startswith('**') and ':' in line:
                clean = line.replace('**','')
                skills_data.append(clean.split(':', 1))

            # Job title
            elif line.startswith('### '):
                story.append(Spacer(1, 3))
                story.append(Paragraph(line.replace('### ', ''), job_style))

            # Company/University
            elif line.startswith('**') and ('Company' in line or 'University' in line or 'College' in line):
                story.append(Paragraph(line.replace('**',''), company_style))

            # Date
            elif line.startswith('*') and ('–' in line or '-' in line or 'Present' in line):
                story.append(Paragraph(f"<i>{line.replace('*','')}</i>", date_style))

            # Bullets
            elif line.startswith('- '):
                story.append(Paragraph(f'• {line[2:]}', bullet_style))

            # Projects
            elif current_section == 'projects' and line.startswith('**'):
                story.append(Paragraph(line.replace('**',''), normal_style))

            # Education
            elif current_section == 'education' and (line.startswith('**') or not line.startswith('#')):
                if line.startswith('**'):
                    story.append(Paragraph(line.replace('**',''), normal_style))
                elif '*' in line:
                    story.append(Paragraph(f"<i>{line.replace('*','')}</i>", date_style))

            # Certifications/Additional
            elif current_section in ['certifications', 'additional information'] and line.startswith('- '):
                story.append(Paragraph(f'• {line[2:]}', bullet_style))

            # Regular text
            elif not line.startswith('#') and not line.startswith('**'):
                story.append(Paragraph(line, normal_style))

        # Render skills as table for tech template
        if skills_data and t["two_col_skills"]:
            table_data = []
            for row in skills_data:
                if len(row) == 2:
                    table_data.append([
                        Paragraph(f"<b>{row[0]}</b>", ParagraphStyle('SkillCat', parent=normal_style, fontName=t["font_name"], fontSize=t["body_size"], textColor=t["accent_color"])),
                        Paragraph(row[1].strip(), normal_style)
                    ])
            if table_data:
                skill_table = Table(table_data, colWidths=[1.3*inch, 5.5*inch])
                skill_table.setStyle(TableStyle([
                    ('VALIGN', (0,0), (-1,-1), 'TOP'),
                    ('LEFTPADDING', (0,0), (0,-1), 0),
                    ('RIGHTPADDING', (0,0), (0,-1), 8),
                    ('LEFTPADDING', (1,0), (1,-1), 0),
                    ('BOTTOMPADDING', (0,0), (-1,-1), 2),
                    ('TOPPADDING', (0,0), (-1,-1), 2),
                ]))
                story.append(skill_table)

        doc.build(story)

        return FileResponse(tmp_path, media_type='application/pdf', filename='resume.pdf')

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")

@app.get("/api/usage")
async def get_usage(
    request: Request,
    authorization: str = Header(None),
    db: Session = Depends(get_db)
):
    user_id = get_user_id(request, authorization)
    limit = check_limit(user_id, db)
    return {
        "remaining_uses": limit["remaining"],
        "is_pro": limit["is_pro"],
        "user_id": user_id
    }

@app.get("/api/history")
async def get_history(
    request: Request,
    authorization: str = Header(None),
    db: Session = Depends(get_db)
):
    user_id = get_user_id(request, authorization)
    analyses = db.query(ResumeAnalysis).filter(ResumeAnalysis.client_ip == user_id).order_by(ResumeAnalysis.created_at.desc()).all()
    return [{"id":a.id,"overall_score":a.overall_score,"keyword_match":a.keyword_match,"formatting_score":a.formatting_score,"summary":a.summary,"created_at":a.created_at.isoformat()} for a in analyses]

@app.get("/health")
async def health():
    return {"status": "ok", "service": "resume-ai-api"}

@app.get("/")
async def root():
    return {"message": "Resume AI API is running", "docs": "/docs"}