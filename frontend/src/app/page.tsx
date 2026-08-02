'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Upload, FileText, Loader2, CheckCircle, AlertCircle, Star, 
  TrendingUp, AlertTriangle, Copy, Check, X, 
  Download, ChevronRight, Sparkles, LayoutTemplate
} from 'lucide-react';

const API_URL = 'http://localhost:8000';

interface AnalysisResult {
  overall_score: number;
  keyword_match: number;
  formatting_score: number;
  missing_skills: string[];
  strengths: string[];
  improvements: string[];
  summary: string;
  remaining_uses?: number;
}

interface RewriteResult {
  original: string;
  rewritten: string;
  section_type: string;
}

const TEMPLATES = [
  { id: 'modern', name: 'Modern', desc: 'Centered header, Helvetica, blue accents, standard spacing', color: 'bg-blue-700' },
  { id: 'classic', name: 'Classic', desc: 'Left-aligned, Times New Roman, serif font, wider margins', color: 'bg-gray-800' },
  { id: 'minimal', name: 'Minimal', desc: 'Ultra-compact, no lines, centered everything, tightest spacing', color: 'bg-neutral-900' },
  { id: 'tech', name: 'Tech', desc: 'Skills sidebar table, slate background, left-aligned, cyan accents', color: 'bg-cyan-600' },
  { id: 'executive', name: 'Executive', desc: 'Dense header band, uppercase sections, smallest fonts, amber', color: 'bg-amber-700' },
];

function ScoreCircle({ label, score }: { label: string; score: number }) {
  const color = score >= 80 ? 'text-green-500' : score >= 60 ? 'text-yellow-500' : 'text-red-500';
  const circumference = 2 * Math.PI * 28;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="text-center p-4 bg-gray-50 rounded-lg">
      <div className={`${color} mb-1 flex justify-center`}>
        {label === 'Overall' && <Star className="w-5 h-5" />}
        {label === 'Keywords' && <TrendingUp className="w-5 h-5" />}
        {label === 'Format' && <CheckCircle className="w-5 h-5" />}
      </div>
      <div className="relative w-16 h-16 mx-auto mb-2">
        <svg className="w-16 h-16 transform -rotate-90">
          <circle cx="32" cy="32" r="28" stroke="#e5e7eb" strokeWidth="4" fill="none" />
          <circle
            cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="none"
            className={color}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center text-lg font-bold ${color}`}>
          {score}
        </span>
      </div>
      <p className="text-xs font-medium text-gray-600">{label}</p>
    </div>
  );
}

export default function Home() {
  const [resumeText, setResumeText] = useState('');
  const [jobDesc, setJobDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState('');
  const [remainingUses, setRemainingUses] = useState(3);

  const [showRewriteModal, setShowRewriteModal] = useState(false);
  const [rewriteResult, setRewriteResult] = useState<RewriteResult | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('modern');
  const [copied, setCopied] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'raw'>('preview');

  useEffect(() => {
    const fetchUsage = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/usage`);
        setRemainingUses(res.data.remaining_uses);
      } catch (err) {
        console.log('Could not fetch usage', err);
      }
    };
    fetchUsage();
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post(`${API_URL}/api/extract-pdf`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setResumeText(res.data.text);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to extract PDF');
    } finally {
      setUploading(false);
    }
  };

  const analyze = async () => {
    if (!resumeText.trim() || !jobDesc.trim()) {
      setError('Please provide both resume and job description');
      return;
    }
    setLoading(true);
    setError('');
    setRewriteResult(null);
    try {
      const res = await axios.post(`${API_URL}/api/analyze`, {
        resume_text: resumeText,
        job_description: jobDesc
      });
      setResult(res.data);
      if (res.data.remaining_uses !== undefined) {
        setRemainingUses(res.data.remaining_uses);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Analysis failed');
      if (err.response?.status === 429) {
        setRemainingUses(0);
      }
    } finally {
      setLoading(false);
    }
  };

  const openRewriteModal = async () => {
    if (!resumeText.trim() || !jobDesc.trim()) return;
    setShowRewriteModal(true);
    setRewriting(true);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/api/rewrite`, {
        section_type: 'full',
        original_text: resumeText,
        job_description: jobDesc
      });
      setRewriteResult(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Rewrite failed');
      setShowRewriteModal(false);
    } finally {
      setRewriting(false);
    }
  };

  const closeModal = () => {
    setShowRewriteModal(false);
    setRewriteResult(null);
    setCopied(false);
    setActiveTab('preview');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadPDF = async () => {
    if (!rewriteResult) return;
    setGeneratingPDF(true);
    try {
      const res = await axios.post(`${API_URL}/api/generate-pdf`, {
        content: rewriteResult.rewritten,
        template: selectedTemplate
      }, { responseType: 'blob' });
      
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'resume.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError('Failed to generate PDF');
    } finally {
      setGeneratingPDF(false);
    }
  };

  const parseResumeLines = (text: string) => {
    return text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  };

  const ResumePreview = ({ text, templateId }: { text: string; templateId: string }) => {
    const lines = parseResumeLines(text);
    
    const templates: Record<string, any> = {
      modern: {
        nameColor: 'text-blue-900',
        accent: 'border-blue-600',
        font: 'font-sans',
        nameAlign: 'text-center',
        contactAlign: 'text-center',
        sectionAlign: 'text-left',
        nameSize: 'text-xl',
        contactSize: 'text-[10px]',
        bodySize: 'text-[10px]',
        lineHeight: 'leading-snug',
        sectionLine: true,
        sectionUppercase: false,
        marginTop: 'mt-3',
        marginBottom: 'mb-1',
      },
      classic: {
        nameColor: 'text-gray-900',
        accent: 'border-gray-800',
        font: 'font-serif',
        nameAlign: 'text-left',
        contactAlign: 'text-left',
        sectionAlign: 'text-left',
        nameSize: 'text-lg',
        contactSize: 'text-[10px]',
        bodySize: 'text-[10.5px]',
        lineHeight: 'leading-relaxed',
        sectionLine: true,
        sectionUppercase: false,
        marginTop: 'mt-4',
        marginBottom: 'mb-1',
      },
      minimal: {
        nameColor: 'text-black',
        accent: 'border-gray-400',
        font: 'font-sans',
        nameAlign: 'text-center',
        contactAlign: 'text-center',
        sectionAlign: 'text-center',
        nameSize: 'text-2xl',
        contactSize: 'text-[9px]',
        bodySize: 'text-[9px]',
        lineHeight: 'leading-tight',
        sectionLine: false,
        sectionUppercase: false,
        marginTop: 'mt-2',
        marginBottom: 'mb-0.5',
      },
      tech: {
        nameColor: 'text-slate-900',
        accent: 'border-cyan-600',
        font: 'font-sans',
        nameAlign: 'text-left',
        contactAlign: 'text-left',
        sectionAlign: 'text-left',
        nameSize: 'text-lg',
        contactSize: 'text-[9.5px]',
        bodySize: 'text-[9.5px]',
        lineHeight: 'leading-snug',
        sectionLine: true,
        sectionUppercase: false,
        marginTop: 'mt-3',
        marginBottom: 'mb-1',
      },
      executive: {
        nameColor: 'text-slate-800',
        accent: 'border-amber-700',
        font: 'font-sans',
        nameAlign: 'text-center',
        contactAlign: 'text-center',
        sectionAlign: 'text-left',
        nameSize: 'text-base',
        contactSize: 'text-[9px]',
        bodySize: 'text-[9px]',
        lineHeight: 'leading-tight',
        sectionLine: true,
        sectionUppercase: true,
        marginTop: 'mt-2',
        marginBottom: 'mb-0.5',
      },
    };
    
    const t = templates[templateId] || templates.modern;
    
    return (
      <div className={`bg-white p-5 min-h-[800px] ${t.font} ${t.lineHeight}`}>
        {lines.map((line, i) => {
          // Name
          if (line.startsWith('# ') && !line.startsWith('## ')) {
            return (
              <h1 key={i} className={`${t.nameSize} font-bold ${t.nameColor} ${t.nameAlign} mb-1`}>
                {line.replace('# ', '')}
              </h1>
            );
          }
          
          // Contact
          if (line.includes('|') && (line.includes('@') || line.includes('linkedin') || /^\d/.test(line))) {
            return (
              <p key={i} className={`${t.contactSize} text-gray-500 ${t.contactAlign} mb-2`}>
                {line.replace(/\*\*/g, '').replace(/\*/g, '')}
              </p>
            );
          }
          
          // Section headers
          if (line.startsWith('## ')) {
            const sectionName = line.replace('## ', '');
            return (
              <div key={i} className={`${t.marginTop} ${t.marginBottom}`}>
                <h2 className={`${t.contactSize} font-bold ${t.sectionUppercase ? 'uppercase tracking-widest' : 'tracking-wider'} ${t.nameColor} ${t.sectionAlign}`}>
                  {t.sectionUppercase ? sectionName.toUpperCase() : sectionName}
                </h2>
                {t.sectionLine && <div className={`border-b ${t.accent} mt-0.5`}></div>}
              </div>
            );
          }
          
          // Job title
          if (line.startsWith('### ')) {
            return (
              <h3 key={i} className={`${t.bodySize} font-bold text-gray-900 mt-2 mb-0`}>
                {line.replace('### ', '')}
              </h3>
            );
          }
          
          // Company / bold with colon (skills categories)
          if (line.startsWith('**') && line.endsWith('**')) {
            const clean = line.replace(/\*\*/g, '');
            if (clean.includes(':')) {
              return (
                <div key={i} className="mb-0.5">
                  <span className={`font-semibold text-gray-800 ${t.bodySize}`}>{clean.split(':')[0]}:</span>
                  <span className={`text-gray-600 ${t.bodySize} ml-1`}>{clean.split(':')[1]}</span>
                </div>
              );
            }
            return (
              <p key={i} className={`${t.bodySize} font-semibold text-gray-700 mt-0.5`}>
                {clean}
              </p>
            );
          }
          
          // Date
          if (line.startsWith('*') && (line.includes('–') || line.includes('-') || line.includes('Present'))) {
            return (
              <p key={i} className={`${t.contactSize} text-gray-500 italic mb-0.5`}>
                {line.replace(/\*/g, '')}
              </p>
            );
          }
          
          // Bullets
          if (line.startsWith('- ')) {
            return (
              <div key={i} className="flex gap-1.5 ml-1 mb-0.5">
                <span className="text-gray-400 text-[8px] mt-1">•</span>
                <p className={`${t.bodySize} text-gray-700`}>{line.replace('- ', '')}</p>
              </div>
            );
          }
          
          // Regular text
          return (
            <p key={i} className={`${t.bodySize} text-gray-700 mb-0.5`}>
              {line.replace(/\*\*/g, '')}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-8 h-8 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-900">ResumeAI</h1>
          </div>
          <div className="flex gap-3">
            <button className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Sign In</button>
            <button className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">Get Pro — $9.99/mo</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900 mb-3">Beat the ATS. Land the Interview.</h2>
          <p className="text-gray-600 max-w-2xl mx-auto">Upload your resume, paste a job description, and get AI-powered feedback.</p>
        </div>

        <div className="text-center mb-6">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${
            remainingUses > 1 ? 'bg-blue-50 text-blue-700' : remainingUses === 1 ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'
          }`}>
            {remainingUses > 0 ? (
              <>
                <span className="w-2 h-2 rounded-full bg-current"></span>
                {remainingUses} free {remainingUses === 1 ? 'analysis' : 'analyses'} remaining today
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4" />
                No free analyses left — Upgrade to Pro
              </>
            )}
          </span>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
            <AlertCircle className="w-5 h-5" /> {error}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-600" /> Your Resume
              </h3>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                <input type="file" accept=".pdf" onChange={handleFileUpload} className="hidden" id="resume-upload" />
                <label htmlFor="resume-upload" className="cursor-pointer block">
                  <Upload className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">{uploading ? 'Extracting text...' : 'Click to upload PDF'}</p>
                </label>
              </div>
              <textarea 
                value={resumeText} 
                onChange={(e) => setResumeText(e.target.value)} 
                className="mt-4 w-full h-48 p-3 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none" 
                placeholder="Or paste your resume text here..." 
              />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" /> Job Description
              </h3>
              <textarea 
                value={jobDesc} 
                onChange={(e) => setJobDesc(e.target.value)} 
                className="w-full h-48 p-3 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none" 
                placeholder="Paste the job description here..." 
              />
            </div>

            <button 
              onClick={analyze} 
              disabled={loading || !resumeText || !jobDesc || remainingUses === 0} 
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Analyzing...</> : remainingUses === 0 ? 'Upgrade to Pro' : 'Analyze My Resume'}
            </button>
          </div>

          <div className="space-y-6">
            {result ? (
              <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
                <h3 className="font-semibold text-gray-900 text-lg">Analysis Results</h3>
                
                <div className="grid grid-cols-3 gap-4">
                  <ScoreCircle label="Overall" score={result.overall_score} />
                  <ScoreCircle label="Keywords" score={result.keyword_match} />
                  <ScoreCircle label="Format" score={result.formatting_score} />
                </div>

                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-900">{result.summary}</p>
                </div>

                {result.strengths && result.strengths.length > 0 && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" /> Strengths
                    </h4>
                    <ul className="space-y-1">
                      {result.strengths.map((s, i) => <li key={i} className="text-sm text-gray-600 pl-6">• {s}</li>)}
                    </ul>
                  </div>
                )}

                {result.missing_skills && result.missing_skills.length > 0 && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-500" /> Missing Skills
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {result.missing_skills.map((skill, i) => (
                        <span key={i} className="px-2 py-1 bg-red-50 text-red-700 text-xs rounded-full">{skill}</span>
                      ))}
                    </div>
                  </div>
                )}

                {result.improvements && result.improvements.length > 0 && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue-500" /> Recommended Improvements
                    </h4>
                    <ul className="space-y-2">
                      {result.improvements.map((imp, i) => (
                        <li key={i} className="text-sm text-gray-600 p-3 bg-gray-50 rounded-lg">{i + 1}. {imp}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="border-t border-gray-200 pt-5">
                  <button 
                    onClick={openRewriteModal}
                    disabled={rewriting}
                    className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-purple-200 transition-all"
                  >
                    {rewriting ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> Generating...</>
                    ) : (
                      <><Sparkles className="w-5 h-5" /> AI Rewrite My Resume <ChevronRight className="w-4 h-4" /></>
                    )}
                  </button>
                  <p className="text-xs text-gray-400 text-center mt-2">Opens professional resume builder with templates</p>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">Upload your resume and a job description to see your analysis</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {showRewriteModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            
            <div className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <Sparkles className="w-6 h-6 text-purple-400" />
                <div>
                  <h2 className="text-lg font-bold">AI Resume Builder</h2>
                  <p className="text-xs text-gray-400">Professional 1-page resume • ATS-optimized</p>
                </div>
              </div>
              <button onClick={closeModal} className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              
              <div className="w-72 bg-gray-50 border-r border-gray-200 p-5 overflow-y-auto shrink-0">
                
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1">
                  <LayoutTemplate className="w-3 h-3" /> Choose Template
                </h3>
                
                <div className="space-y-2 mb-6">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTemplate(t.id)}
                      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                        selectedTemplate === t.id 
                          ? 'border-blue-500 bg-blue-50 shadow-sm' 
                          : 'border-transparent bg-white hover:bg-gray-100'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-10 rounded ${t.color} shadow-sm`}></div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                          <p className="text-xs text-gray-500">{t.desc}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Actions</h3>
                
                <div className="space-y-2">
                  <button 
                    onClick={() => copyToClipboard(rewriteResult?.rewritten || '')}
                    className="w-full py-2.5 px-3 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors"
                  >
                    {copied ? <><Check className="w-4 h-4 text-green-500" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Text</>}
                  </button>
                  
                  <button 
                    onClick={downloadPDF}
                    disabled={generatingPDF || !rewriteResult}
                    className="w-full py-2.5 px-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                  >
                    {generatingPDF ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Generating PDF...</>
                    ) : (
                      <><Download className="w-4 h-4" /> Download PDF</>
                    )}
                  </button>
                </div>

                <div className="mt-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-xs text-yellow-800">
                    <AlertCircle className="w-3 h-3 inline mr-1" />
                    All data comes from your original resume. No fabricated information.
                  </p>
                </div>
              </div>

              <div className="flex-1 bg-gray-200 overflow-y-auto p-8">
                {rewriting ? (
                  <div className="h-full flex flex-col items-center justify-center">
                    <Loader2 className="w-12 h-12 animate-spin text-blue-600 mb-4" />
                    <p className="text-gray-600 font-medium">Building your professional resume...</p>
                    <p className="text-sm text-gray-400 mt-1">This may take 10-15 seconds</p>
                  </div>
                ) : rewriteResult ? (
                  <div className="max-w-[680px] mx-auto">
                    <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-4 w-fit mx-auto">
                      <button 
                        onClick={() => setActiveTab('preview')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          activeTab === 'preview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Preview
                      </button>
                      <button 
                        onClick={() => setActiveTab('raw')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          activeTab === 'raw' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Raw Text
                      </button>
                    </div>

                    {activeTab === 'preview' ? (
                      <div className="bg-white shadow-xl rounded-lg overflow-hidden">
                        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-red-400"></div>
                          <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                          <div className="w-3 h-3 rounded-full bg-green-400"></div>
                          <span className="text-xs text-gray-400 ml-2">Resume Preview — {selectedTemplate.charAt(0).toUpperCase() + selectedTemplate.slice(1)}</span>
                        </div>
                        <ResumePreview text={rewriteResult.rewritten} templateId={selectedTemplate} />
                      </div>
                    ) : (
                      <div className="bg-gray-900 rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2 bg-gray-800">
                          <span className="text-xs text-gray-400 font-mono">resume.md</span>
                          <button onClick={() => copyToClipboard(rewriteResult.rewritten)} className="text-xs text-gray-400 hover:text-white">
                            {copied ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                        <pre className="p-4 text-sm text-gray-300 font-mono whitespace-pre-wrap overflow-x-auto max-h-[600px] overflow-y-auto">
                          {rewriteResult.rewritten}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-gray-500">Something went wrong. Please try again.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}