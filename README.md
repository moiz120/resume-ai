# ResumeAI

<p align="center">
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" />
  <img src="https://img.shields.io/badge/Groq-FF6B6B?style=for-the-badge&logo=openai&logoColor=white" />
</p>

<p align="center">
  <b>AI-powered resume analyzer and rewriter.</b><br>
  Beat the ATS. Land the interview.
</p>

---

## Features

- **ATS Resume Analysis** — Upload your resume + paste a job description to get instant scores on keywords, formatting, and overall match
- **AI Resume Rewrite** — Generate a complete, professional 1-page resume tailored to any job posting
- **5 Professional Templates** — Modern, Classic, Minimal, Tech (Skills-First), and Executive
- **PDF Export** — Download your rewritten resume as a beautifully formatted PDF
- **Usage Tracking** — 3 free analyses per day with PostgreSQL-backed persistence
- **Admin Dashboard** — Unlimited access for local development

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | FastAPI, SQLAlchemy, PostgreSQL |
| **AI Engine** | Groq API (Llama 3.1-8B Instant) |
| **PDF Generation** | ReportLab |
| **Frontend** | Next.js 16, TypeScript, Tailwind CSS v4 |
| **Database** | PostgreSQL 16 |

---

## Screenshots

> *Add screenshots here after deployment*

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- PostgreSQL 16

### 1. Clone the repository

```bash
git clone https://github.com/moiz120/resume-ai.git
cd resume-ai
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate (Windows PowerShell)
venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Create database in PostgreSQL
# Then copy environment variables
cp .env.example .env

# Edit .env with your real Groq API key and DB password
```

### 3. Initialize Database

```bash
python init_db.py
```

### 4. Run Backend

```bash
uvicorn main:app --reload --port 8000 --host 0.0.0.0
```

### 5. Frontend Setup

```bash
cd ../frontend

# Install dependencies
npm install

# Run dev server
npm run dev
```

### 6. Open App

Navigate to `http://localhost:3000`

---

## Environment Variables

Create `backend/.env` from the example file:

| Variable | Description |
|----------|--------------|
| `GROQ_API_KEY` | Your Groq API key (get one [here](https://groq.com)) |
| `DATABASE_URL` | PostgreSQL connection string |

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|--------------|
| `/api/extract-pdf` | POST | Extract text from resume PDF |
| `/api/analyze` | POST | Get ATS scores vs job description |
| `/api/rewrite` | POST | Generate AI-optimized resume |
| `/api/generate-pdf` | POST | Download resume as PDF |
| `/api/usage` | GET | Check remaining free analyses |
| `/api/history` | GET | View past analyses |
| `/health` | GET | Service health check |

---

## Project Structure

```
resume-ai/
├── backend/
│   ├── main.py              # FastAPI application
│   ├── init_db.py           # Database initializer
│   ├── requirements.txt     # Python dependencies
│   ├── .env.example         # Environment template
│   └── models/
│       ├── database.py      # SQLAlchemy engine
│       └── models.py        # Table definitions
├── frontend/
│   └── src/
│       └── app/
│           ├── page.tsx       # Main UI
│           ├── layout.tsx     # Root layout
│           └── globals.css    # Tailwind styles
└── .gitignore
```

---

## Deployment

- **Backend:** Deploy to DigitalOcean, Railway, or Render
- **Frontend:** Deploy to Vercel
- **Database:** Use managed PostgreSQL (DigitalOcean, Supabase, or AWS RDS)

---

## License

MIT License — feel free to use, modify, and distribute.
