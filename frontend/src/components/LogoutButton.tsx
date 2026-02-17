'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

export default function LogoutButton() {
  const { setUser } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    setUser(null);
    router.push('/');
  };

  return (
    <Button 
      onClick={handleLogout} 
      variant="outline" 
      className="w-full"
      size="sm"
    >
      <LogOut className="h-4 w-4 mr-2" />
      Logout
    </Button>
  );
}
