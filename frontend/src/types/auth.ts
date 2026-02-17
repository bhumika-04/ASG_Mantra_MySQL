// Match database role names exactly (capital letters with spaces)
export type UserRole = 'Admin' | 'Manager' | 'Blinkit Distributor' | 'Amazon Distributor';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  permissions?: string[];
}

export interface AuthContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

// Role constants matching database values
export const ROLES = {
  ADMIN: 'Admin' as UserRole,
  MANAGER: 'Manager' as UserRole,
  BLINKIT_DISTRIBUTOR: 'Blinkit Distributor' as UserRole,
  AMAZON_DISTRIBUTOR: 'Amazon Distributor' as UserRole,
};

export const ROLE_LABELS = {
  [ROLES.ADMIN]: 'Admin',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.BLINKIT_DISTRIBUTOR]: 'Blinkit Distributor',
  [ROLES.AMAZON_DISTRIBUTOR]: 'Amazon Distributor',
};
