'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import HistoryList from '@/components/pdfx/HistoryList';
import { Upload, FileText, Download, Eye, Clock, CheckCircle, XCircle, Languages, Sparkles } from 'lucide-react';

export default function PdfxHome() {
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [lang, setLang] = useState('English');
  const [jobId, setJobId] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [message, setMessage] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [dragActive, setDragActive] = useState(false);
  const pollRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === 'application/pdf') {
        setFile(droppedFile);
      }
    }
  };

  const startUpload = async () => {
    if (!file) return;

    const fd = new FormData();
    fd.append('file', file);
    fd.append('targetLang', lang);

    const res = await fetch('/api/pdfx/upload', { method: 'POST', body: fd });
    const json = await res.json();
    if (!json.success) {
      alert(json.error || 'Upload failed');
      return;
    }
    setJobId(json.jobId);
    setProgress(0);
    setMessage('Queued');
    setStatus('processing');

    pollRef.current = setInterval(async () => {
      const sres = await fetch(`/api/pdfx/status?jobId=${json.jobId}`);
      const sjson = await sres.json();
      if (sjson.success) {
        setProgress(sjson.job.progress || 0);
        setMessage(sjson.job.message || '');
        setStatus(sjson.job.status);
        if (sjson.job.status === 'completed' || sjson.job.status === 'error') {
          clearInterval(pollRef.current);
        }
      }
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return (
    <div className="bg-gradient-to-br from-slate-50 via-blue-50/30 to-purple-50/20">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-purple-600 to-teal-600">
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="relative mx-auto max-w-7xl px-6 py-16 sm:py-24">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-sm text-white/90 backdrop-blur-sm mb-6">
              <Sparkles className="h-4 w-4" />
              AI-Powered Translation
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
              PDF Translator
            </h1>
            <p className="mt-6 text-lg leading-8 text-white/90 max-w-2xl mx-auto">
              Transform your PDF documents into any language with precision and speed.
              Powered by advanced AI technology for accurate, context-aware translations.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-12">
        {/* Tab Navigation */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex items-center p-1 bg-white/70 backdrop-blur-sm rounded-xl shadow-lg border border-white/50">
            <button
              onClick={() => setActiveTab('upload')}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === 'upload'
                ? 'bg-white text-blue-600 shadow-md'
                : 'text-gray-600 hover:text-gray-800 hover:bg-white/50'
                }`}
            >
              <Upload className="h-4 w-4" />
              New Translation
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab === 'history'
                ? 'bg-white text-blue-600 shadow-md'
                : 'text-gray-600 hover:text-gray-800 hover:bg-white/50'
                }`}
            >
              <Clock className="h-4 w-4" />
              History
            </button>
          </div>
        </div>

        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Upload Card */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/50 overflow-hidden">
              <div className="p-8">
                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                    <FileText className="h-8 w-8 text-blue-600" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">Upload Your PDF</h2>
                  <p className="text-gray-600">Select a PDF document to translate into your preferred language</p>
                </div>

                {/* File Upload Area */}
                <div
                  className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-all duration-200 ${dragActive
                    ? 'border-blue-400 bg-blue-50'
                    : file
                      ? 'border-green-400 bg-green-50'
                      : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                    }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={e => setFile(e.target.files?.[0] || null)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />

                  {file ? (
                    <div className="flex items-center justify-center gap-3">
                      <CheckCircle className="h-8 w-8 text-green-500" />
                      <div>
                        <p className="text-lg font-medium text-green-700">{file.name}</p>
                        <p className="text-sm text-green-600">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-lg font-medium text-gray-900 mb-2">
                        Drop your PDF here, or click to browse
                      </p>
                      <p className="text-sm text-gray-500">Supports PDF files up to 50MB</p>
                    </div>
                  )}
                </div>

                {/* Language Selection */}
                <div className="mt-8">
                  <label className="block text-sm font-medium text-gray-700 mb-3">
                    <Languages className="inline h-4 w-4 mr-2" />
                    Target Language
                  </label>
                  <select
                    className="w-full px-4 py-3 bg-white/80 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    value={lang}
                    onChange={e => setLang(e.target.value)}
                  >
                    <option>English</option>
                    <option>Arabic</option>
                    <option>Russian</option>
                    <option>Uzbek</option>
                    <option>French</option>
                    <option>Spanish</option>
                    <option>German</option>
                    <option>Chinese</option>
                    <option>Japanese</option>
                  </select>
                </div>

                {/* Start Button */}
                <div className="mt-8 flex justify-center">
                  <button
                    onClick={startUpload}
                    className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white text-lg font-medium rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    disabled={!file}
                  >
                    <Sparkles className="h-5 w-5" />
                    Start Translation
                  </button>
                </div>
              </div>
            </div>

            {/* Progress Card */}
            {jobId && (
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/50 overflow-hidden">
                <div className="p-8">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900">Translation Progress</h3>
                      <p className="text-sm text-gray-500 font-mono">Job ID: {jobId}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {status === 'completed' ? (
                        <CheckCircle className="h-6 w-6 text-green-500" />
                      ) : status === 'error' ? (
                        <XCircle className="h-6 w-6 text-red-500" />
                      ) : (
                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" />
                      )}
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${status === 'completed'
                        ? 'bg-green-100 text-green-700'
                        : status === 'error'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-blue-100 text-blue-700'
                        }`}>
                        {status}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">{message}</span>
                      <span className="text-sm font-medium text-gray-900">{progress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                  {/* Action Buttons */}
                  {status === 'completed' && (
                    <div className="flex flex-col sm:flex-row gap-4 pt-4">
                      <Link
                        href={`/esg/pdfx/${jobId}/view`}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors"
                      >
                        <Eye className="h-4 w-4" />
                        View Translation
                      </Link>
                      <a
                        href={`/api/pdfx/download?jobId=${jobId}`}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors"
                      >
                        <Download className="h-4 w-4" />
                        Download PDF
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="max-w-6xl mx-auto">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/50 overflow-hidden">
              <div className="p-8">
                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4">
                    <Clock className="h-8 w-8 text-purple-600" />
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">Translation History</h2>
                  <p className="text-gray-600">Manage and access all your translated documents</p>
                </div>
                <HistoryList />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
