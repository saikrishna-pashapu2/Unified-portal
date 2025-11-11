'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ChevronDown, BarChart3, FileText, Search, FileCheck } from 'lucide-react';

interface ToolsDropdownProps {
  domain: 'esg' | 'credit';
  base: string;
}

export default function ToolsDropdown({ domain, base }: ToolsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const allTools = domain === 'esg' 
    ? [
        { href: `${base}/tenders`, icon: FileCheck, label: 'Tenders' },
        { href: `${base}/tools`, icon: BarChart3, label: 'ESG Score Tool' },
        { href: `${base}/pdfx`, icon: FileText, label: 'PDF Translator' },
      ]
    : [
        { href: `${base}/tenders`, icon: FileCheck, label: 'Tenders' },
        { href: `${base}/tools/fitch`, icon: Search, label: 'Fitch Tool' },
      ];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          relative rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:bg-[var(--surface-2)] focus-ring
          text-[var(--text)] inline-flex items-center gap-2
          before:absolute before:bottom-0 before:left-1/2 before:h-0.5 before:w-0 before:bg-[var(--brand)] before:transition-all before:duration-200
          hover:before:w-full hover:before:left-0
        `}
      >
        <BarChart3 size={16} />
        Tools
        <ChevronDown 
          size={14} 
          className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-[var(--border)] py-2 z-50">
          {allTools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-[var(--text)] hover:bg-[var(--surface-2)]"
            >
              <tool.icon size={16} className="text-[var(--text-muted)]" />
              {tool.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}