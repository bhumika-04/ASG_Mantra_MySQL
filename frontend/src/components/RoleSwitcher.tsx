'use client';

import { useAuth } from '@/contexts/AuthContext';
import { ROLES, ROLE_LABELS, User } from '@/types/auth';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';

export function RoleSwitcher() {
  const { user, setUser } = useAuth();
  const [selectedRole, setSelectedRole] = useState(user?.role || ROLES.ADMIN);

  const handleRoleChange = (role: string) => {
    const mockUser: User = {
      id: '1',
      name: 'Test User',
      email: 'test@techgenia.com',
      role: role as any,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${role}`,
    };
    setSelectedRole(role as any);
    setUser(mockUser);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-background border rounded-lg shadow-lg p-4 max-w-xs">
      <div className="text-sm font-medium mb-2">Dev Mode: Switch Role</div>
      <Select value={selectedRole} onValueChange={handleRoleChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ROLES.ADMIN}>{ROLE_LABELS[ROLES.ADMIN]}</SelectItem>
          <SelectItem value={ROLES.MANAGER}>{ROLE_LABELS[ROLES.MANAGER]}</SelectItem>
          <SelectItem value={ROLES.BLINKIT_DISTRIBUTOR}>
            {ROLE_LABELS[ROLES.BLINKIT_DISTRIBUTOR]}
          </SelectItem>
          <SelectItem value={ROLES.AMAZON_DISTRIBUTOR}>
            {ROLE_LABELS[ROLES.AMAZON_DISTRIBUTOR]}
          </SelectItem>
        </SelectContent>
      </Select>
      <div className="mt-2 text-xs text-muted-foreground">
        Current: {user ? ROLE_LABELS[user.role] : 'Not logged in'}
      </div>
    </div>
  );
}
