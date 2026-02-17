'use client';

import { useState, useEffect } from 'react';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { FilterBar } from '@/components/ui/filter-bar';
import { DataGrid, GridColumn, useDataGrid, ViewOptionsButton } from '@/components/ui/data-grid';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Manager' | 'Amazon Distributor' | 'Blinkit Distributor';
  status: 'active' | 'inactive';
  created: string;
}

const roleLabels: Record<string, string> = {
  'Admin': 'Admin',
  'Manager': 'Manager',
  'Amazon Distributor': 'Amazon Distributor',
  'Blinkit Distributor': 'Blinkit Distributor',
};

export default function UserManagementPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'Manager' as User['role'],
  });
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const response = await api.users.getAll() as any;

      // Transform users to match our interface
      const transformedUsers: User[] = (Array.isArray(response) ? response : []).map((user: any) => ({
        id: user.id.toString(),
        name: user.name || user.email,
        email: user.email,
        role: user.role as User['role'],
        status: (user.is_active ? 'active' : 'inactive') as 'active' | 'inactive',
        created: new Date(user.created_at).toLocaleDateString('en-US', {
          month: 'numeric',
          day: 'numeric',
          year: 'numeric'
        }),
      }));

      setUsers(transformedUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveUser = async () => {
    if (!formData.name || !formData.email) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (!editingUser && !formData.password) {
      toast.error('Password is required for new users');
      return;
    }

    try {
      if (editingUser) {
        // Update existing user
        const updateData: any = {
          name: formData.name,
          email: formData.email,
          role: formData.role,
        };

        // Only include password if it was changed
        if (formData.password) {
          updateData.password = formData.password;
        }

        await api.users.update(editingUser.id, updateData);
        toast.success('User updated successfully!');
      } else {
        // Create new user
        await api.users.create({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: formData.role,
        });
        toast.success('User created successfully!');
      }

      setIsDialogOpen(false);
      setEditingUser(null);
      setFormData({ name: '', email: '', password: '', role: 'Manager' });

      // Refresh the user list
      fetchUsers();
    } catch (error: any) {
      console.error('Error saving user:', error);
      toast.error(error.message || `Failed to ${editingUser ? 'update' : 'create'} user`);
    }
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      password: '', // Don't populate password for security
      role: user.role,
    });
    setIsDialogOpen(true);
  };

  const handleDialogClose = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingUser(null);
      setFormData({ name: '', email: '', password: '', role: 'Manager' });
      setShowPassword(false);
    }
  };

  const handleDeleteUser = async (userId: string, userName: string, userRole: string) => {
    // Prevent deletion of Admin users
    if (userRole.toLowerCase() === 'admin') {
      toast.error('Cannot delete Admin user', {
        description: 'Admin users are protected and cannot be deleted',
      });
      return;
    }

    try {
      await api.users.delete(userId);
      toast.success(`${userName} has been removed`);

      // Refresh the user list
      fetchUsers();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast.error(error.message || 'Failed to delete user');
    }
  };

  const gridColumns: GridColumn<User>[] = [
    { id: 'name', header: 'Name', accessorKey: 'name', sortable: true, width: 200, minWidth: 150, cell: (row) => <span className="font-medium">{row.name}</span> },
    { id: 'email', header: 'Email', accessorKey: 'email', width: 250, minWidth: 200, cell: (row) => <span className="text-muted-foreground">{row.email}</span> },
    {
      id: 'role',
      header: 'Role',
      accessorKey: 'role',
      width: 180,
      minWidth: 150,
      cell: (row) => <Badge variant="outline">{roleLabels[row.role]}</Badge>,
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 120,
      minWidth: 100,
      align: 'center',
      cell: (row) => (
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
          {row.status}
        </Badge>
      ),
    },
    { id: 'created', header: 'Created', accessorKey: 'created', width: 120, minWidth: 100, cell: (row) => <span className="text-muted-foreground">{row.created}</span> },
    {
      id: 'actions',
      header: 'Actions',
      width: 120,
      minWidth: 100,
      align: 'center',
      cell: (row) => (
        <div className="flex items-center gap-1 justify-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleEditUser(row)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => handleDeleteUser(row.id, row.name, row.role)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const gridState = useDataGrid(gridColumns);

  // Filter users by search
  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(search.toLowerCase()) ||
    user.email.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) {
    return (
      <ProtectedRoute allowedRoles={['Admin']}>
        <div className="p-6 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-muted-foreground">Loading users...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute allowedRoles={['Admin']}>
      <div className="p-6 space-y-6">
        {/* Filters */}
        <FilterBar
          searchPlaceholder="Search users..."
          searchValue={search}
          onSearchChange={setSearch}
        >
          <div className="flex items-center gap-2 ml-auto">
            <ViewOptionsButton
              columns={gridColumns}
              visibleColumns={gridState.visibleColumns}
              onToggleColumn={gridState.toggleColumnVisibility}
              rowDensity={gridState.rowDensity}
              onDensityChange={gridState.setRowDensity}
            />
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </div>
        </FilterBar>

        {/* Professional Data Grid */}
        {filteredUsers.length > 0 ? (
          <DataGrid
            data={filteredUsers}
            gridState={gridState}
          />
        ) : (
          <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
            <p>No users found</p>
          </div>
        )}

        {/* Add/Edit User Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle>
              <DialogDescription>
                {editingUser ? 'Update user account details and permissions' : 'Create a new user account with specific role permissions'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Full Name</label>
                <Input
                  placeholder="Enter full name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <Input
                  type="email"
                  placeholder="Enter email address"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Password {editingUser && <span className="text-xs text-muted-foreground">(leave blank to keep current)</span>}
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder={editingUser ? "Enter new password (optional)" : "Enter password"}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Role</label>
                <Select
                  value={formData.role}
                  onValueChange={(value: User['role']) => setFormData({ ...formData, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Manager">Manager</SelectItem>
                    <SelectItem value="Admin">Admin</SelectItem>
                    <SelectItem value="Amazon Distributor">Amazon Distributor</SelectItem>
                    <SelectItem value="Blinkit Distributor">Blinkit Distributor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleDialogClose(false)}>Cancel</Button>
              <Button onClick={handleSaveUser}>{editingUser ? 'Update User' : 'Create User'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ProtectedRoute>
  );
}
