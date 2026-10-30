'use client';

import { useState } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { User, Mail, Shield, Eye, EyeOff, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    confirmPassword: '',
  });

  const handleSave = async () => {
    if (formData.password && formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    try {
      const updateData: any = { name: formData.name, email: formData.email };
      if (formData.password) updateData.password = formData.password;
      await api.users.update(user!.id, updateData);
      setUser({ ...user!, name: formData.name, email: formData.email });
      toast.success('Profile updated successfully!');
      setIsEditing(false);
      setFormData({ ...formData, password: '', confirmPassword: '' });
    } catch (error: any) {
      toast.error(error.message || 'Failed to update profile');
    }
  };

  const handleCancel = () => {
    setFormData({ name: user?.name || '', email: user?.email || '', password: '', confirmPassword: '' });
    setIsEditing(false);
  };

  if (!user) return null;

  const initials = user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <ProtectedRoute>
      <div className="p-4 sm:p-6 space-y-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Profile Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account details and password</p>
        </div>

        {/* Profile Card */}
        <Card>
          <CardContent className="pt-5 pb-5">
            {/* Avatar + identity row */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <Avatar className="h-12 w-12 sm:h-14 sm:w-14 ring-2 ring-primary/20 shrink-0">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="text-base font-bold bg-primary/10 text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold truncate">{user.name}</h2>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">{user.role}</span>
                  <Badge className="bg-green-600 text-white text-xs px-1.5 py-0 h-4">Active</Badge>
                </div>
              </div>
              {!isEditing && (
                <Button size="sm" variant="outline" onClick={() => setIsEditing(true)} className="shrink-0 gap-1.5">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              )}
            </div>

            {/* Form fields — only visible when editing */}
            {isEditing && (
              <>
                <div className="border-t pt-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Full Name</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="name"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="pl-9"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email Address</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="email"
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="pl-9"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="password">New Password <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          value={formData.password}
                          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                          placeholder="Leave blank to keep current"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="confirmPassword">Confirm Password</Label>
                      <Input
                        id="confirmPassword"
                        type={showPassword ? 'text' : 'password'}
                        value={formData.confirmPassword}
                        onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                        placeholder="Confirm new password"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
                  <Button variant="outline" size="sm" onClick={handleCancel}>Cancel</Button>
                  <Button size="sm" onClick={handleSave}>Save Changes</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Bottom row: Account Details + Role & Access */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Account Details</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-0">
              {[
                { label: 'User ID', value: <span className="font-mono text-xs text-muted-foreground">{user.id}</span> },
                { label: 'Role', value: <Badge variant="outline" className="text-xs">{user.role}</Badge> },
                { label: 'Status', value: <Badge className="bg-green-600 text-white text-xs">Active</Badge> },
                { label: 'Email', value: <span className="text-sm truncate max-w-[160px] sm:max-w-[240px]">{user.email}</span> },
              ].map(({ label, value }, i, arr) => (
                <div key={label} className={`flex items-center justify-between py-1.5 ${i < arr.length - 1 ? 'border-b' : ''}`}>
                  <span className="text-sm text-muted-foreground">{label}</span>
                  {value}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Role & Access</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                <div className="p-1.5 rounded-full bg-primary/10 shrink-0">
                  <Shield className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{user.role}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Your current access level</p>
                </div>
              </div>
              {user.permissions && user.permissions.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground mb-1.5">Permissions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {user.permissions.map((p) => (
                      <Badge key={p} variant="secondary" className="text-xs">
                        {p.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-3">Access is managed through your assigned role.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ProtectedRoute>
  );
}
