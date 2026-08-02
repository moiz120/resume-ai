from sqlalchemy import Column, Integer, String, DateTime, Text
from datetime import datetime
from .database import Base

class UserUsage(Base):
    __tablename__ = "user_usage"
    
    id = Column(Integer, primary_key=True, index=True)
    client_ip = Column(String, index=True)
    count = Column(Integer, default=0)
    reset_time = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

class ResumeAnalysis(Base):
    __tablename__ = "resume_analyses"
    
    id = Column(Integer, primary_key=True, index=True)
    client_ip = Column(String, index=True)
    resume_text = Column(Text)
    job_description = Column(Text)
    overall_score = Column(Integer)
    keyword_match = Column(Integer)
    formatting_score = Column(Integer)
    missing_skills = Column(Text)
    strengths = Column(Text)
    improvements = Column(Text)
    summary = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)