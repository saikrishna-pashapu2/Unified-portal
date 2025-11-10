'use client';

import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface TenderSaveButtonProps {
  tenderId: number;
}

export default function TenderSaveButton({ tenderId }: TenderSaveButtonProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = async () => {
    if (!session) {
      // Redirect to login
      router.push('/api/auth/signin');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/tenders/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenderId }),
      });

      if (res.ok) {
        setIsSaved(!isSaved);
      }
    } catch (error) {
      console.error('Error saving tender:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleSave}
      disabled={isLoading}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
        isSaved
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
      }`}
    >
      <Bookmark className={`h-4 w-4 ${isSaved ? 'fill-current' : ''}`} />
      {isSaved ? 'Saved' : 'Save'}
    </button>
  );
}
