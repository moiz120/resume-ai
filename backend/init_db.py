from models.database import engine, Base
from models.models import UserUsage, ResumeAnalysis

Base.metadata.create_all(bind=engine)
print("Database tables created successfully!")