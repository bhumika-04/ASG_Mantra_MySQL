'use client';

import { useState, useEffect } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Shield, Plus, Pencil, Trash2, Lock } from 'lucide-react';
import { toast } from 'sonner';

interface Permission {
  id: string;
  name: string;
  description: string;
  checked: boolean;
}

interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  created_at?: string;
  is_locked?: boolean;
}

const availablePermissions: Omit<Permission, 'checked'>[] = [
  { id: 'view-dashboard', name: 'View Dashboard', description: 'Access to main dashboard' },
  { id: 'view-amazon', name: 'View Amazon', description: 'Access to Amazon dashboards and PO' },
  { id: 'view-blinkit', name: 'View Blinkit', description: 'Access to Blinkit dashboards and PO' },
  { id: 'view-sales', name: 'View Sales', description: 'Access to sales reports' },
  { id: 'view-analytics', name: 'View Analytics', description: 'Access to analytics dashboard' },
  { id: 'manage-products', name: 'Manage Products', description: 'Create and edit products' },
  { id: 'manage-inventory', name: 'Manage Inventory', description: 'Update stock levels' },
  { id: 'manage-users', name: 'Manage Users', description: 'Create and manage user accounts' },
  { id: 'manage-roles', name: 'Manage Roles', description: 'Create and manage roles' },
  { id: 'view-reports', name: 'View Reports', description: 'Access to all reports' },
];

export default function RoleManagementPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permissions: [] as string[],
  });

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    try {
      setIsLoading(true);
      const response = await api.roles.getAll() as any;
      setRoles(response);
    } catch (error) {
      console.error('Error fetching roles:', error);
      toast.error('Failed to load roles');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePermissionToggle = (permissionId: string) => {
    setFormData((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permissionId)
        ? prev.permissions.filter((id) => id !== permissionId)
        : [...prev.permissions, permissionId],
    }));
  };

  const handleSaveRole = async () => {
    if (!formData.name || !formData.description) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (formData.permissions.length === 0) {
      toast.error('Please select at least one permission');
      return;
    }

    try {
      if (editingRole) {
        // Update existing role
        await api.roles.update(editingRole.id, formData);
        toast.success('Role updated successfully!', {
          description: `${formData.name} has been updated`,
        });
      } else {
        // Create new role
        await api.roles.create(formData);
        toast.success('Role created successfully!', {
          description: `${formData.name} has been added to the system`,
        });
      }

      setIsDialogOpen(false);
      setEditingRole(null);
      setFormData({ name: '', description: '', permissions: [] });

      // Refresh roles list
      fetchRoles();
    } catch (error: any) {
      console.error('Error saving role:', error);
      toast.error(error.message || `Failed to ${editingRole ? 'update' : 'create'} role`);
    }
  };

  const handleEditRole = (role: Role) => {
    if (role.is_locked || role.name.toLowerCase() === 'admin') {
      toast.error('Cannot edit system role', {
        description: 'This role is protected and cannot be edited',
      });
      return;
    }
    setEditingRole(role);
    setFormData({
      name: role.name,
      description: role.description,
      permissions: role.permissions,
    });
    setIsDialogOpen(true);
  };

  const handleDialogClose = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingRole(null);
      setFormData({ name: '', description: '', permissions: [] });
    }
  };

  const handleDeleteRole = async (roleId: string, roleName: string, isLocked?: boolean) => {
    // Prevent deletion of Admin role
    if (isLocked || roleName.toLowerCase() === 'admin') {
      toast.error('Cannot delete system role', {
        description: 'Admin role is protected and cannot be deleted',
      });
      return;
    }

    try {
      await api.roles.delete(roleId);
      toast.success('Role deleted successfully!', {
        description: `${roleName} has been removed from the system`,
      });

      // Refresh roles list
      fetchRoles();
    } catch (error: any) {
      console.error('Error deleting role:', error);
      toast.error(error.message || 'Failed to delete role');
    }
  };

  const getPermissionBadges = (permissions: string[], maxShow: number = 3) => {
    const permissionNames = permissions
      .map((id) => availablePermissions.find((p) => p.id === id)?.name)
      .filter(Boolean);

    const visible = permissionNames.slice(0, maxShow);
    const remaining = permissionNames.length - maxShow;

    return (
      <div className="flex flex-wrap gap-2">
        {visible.map((name, index) => (
          <span key={index} className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs">
            {name}
          </span>
        ))}
        {remaining > 0 && (
          <span className="px-2 py-1 bg-slate-200 text-slate-600 rounded text-xs font-medium">
            +{remaining} more
          </span>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <ProtectedRoute allowedRoles={['Admin']}>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-muted-foreground">Loading roles...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute allowedRoles={['Admin']}>
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-500" />
                  Roles
                </CardTitle>
                <CardDescription>Manage roles and their associated permissions</CardDescription>
              </div>
              <Button onClick={() => setIsDialogOpen(true)} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                Add Role
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-4 font-medium text-muted-foreground">Role Name</th>
                    <th className="text-left p-4 font-medium text-muted-foreground">Description</th>
                    <th className="text-left p-4 font-medium text-muted-foreground">Permissions</th>
                    <th className="text-left p-4 font-medium text-muted-foreground">Created</th>
                    <th className="text-left p-4 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role.id} className="border-b hover:bg-muted/50">
                      <td className="p-4">
                        <div className="flex items-center gap-2 font-medium">
                          {role.name}
                          {role.is_locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                        </div>
                      </td>
                      <td className="p-4 text-muted-foreground">{role.description}</td>
                      <td className="p-4">{getPermissionBadges(role.permissions)}</td>
                      <td className="p-4 text-muted-foreground">
                        {role.created_at ? new Date(role.created_at).toLocaleDateString('en-US', {
                          month: 'numeric',
                          day: 'numeric',
                          year: 'numeric'
                        }) : 'N/A'}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleEditRole(role)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteRole(role.id, role.name, role.is_locked)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Add Role Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Add New Role</DialogTitle>
              <DialogDescription>Create a new role with specific permissions</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Role Name</label>
                <Input
                  placeholder="Enter role name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="border-2"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <Input
                  placeholder="Enter role description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium">Permissions</label>
                <div className="border rounded-lg p-4 max-h-64 overflow-y-auto space-y-3">
                  {availablePermissions.map((permission) => (
                    <div key={permission.id} className="flex items-start space-x-3">
                      <Checkbox
                        id={permission.id}
                        checked={formData.permissions.includes(permission.id)}
                        onCheckedChange={() => handlePermissionToggle(permission.id)}
                      />
                      <div className="flex-1">
                        <label
                          htmlFor={permission.id}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {permission.name}
                        </label>
                        <p className="text-xs text-muted-foreground mt-1">{permission.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleDialogClose(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveRole} className="bg-blue-600 hover:bg-blue-700">
                {editingRole ? 'Update Role' : 'Create Role'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
