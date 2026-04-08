import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AuthContext, EnhancedUser, Role, Group, Permission } from '../types/auth';

interface AuthStore extends AuthContext {
  // Actions
  login: (user: EnhancedUser, roles: Role[], groups: Group[]) => void;
  logout: () => void;
  updateUser: (user: Partial<EnhancedUser>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  
  // Permission checking
  hasPermission: (permission: Permission, resourceId?: string) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;
  hasRole: (roleId: string) => boolean;
  isInGroup: (groupId: string) => boolean;
  
  // Computed properties
  isAdmin: boolean;
  effectivePermissions: Permission[];
}

const defaultState: AuthContext = {
  user: null,
  roles: [],
  groups: [],
  permissions: [],
  isAuthenticated: false,
  isLoading: false,
  error: null,
};

// System roles and their permissions
export const SYSTEM_ROLES: Record<string, Permission[]> = {
  'super-admin': ['admin:full-access'],
  'admin': [
    'workstations:read',
    'workstations:write',
    'workstations:delete',
    'workstations:manage-all',
    'users:read',
    'users:write',
    'users:delete',
    'groups:read',
    'groups:write',
    'groups:delete',
    'roles:read',
    'roles:write',
    'roles:delete',
    'analytics:read',
    'settings:read',
    'settings:write',
  ],
  'user': [
    'workstations:read',
    'workstations:write',
    'workstations:delete',
  ],
  'viewer': [
    'workstations:read',
    'analytics:read',
  ],
};

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      ...defaultState,

      login: (user: EnhancedUser, roles: Role[], groups: Group[]) => {
        const permissions = calculateEffectivePermissions(user, roles, groups);
        const isAdmin = hasAdminPermissions(permissions);
        
        set({
          user,
          roles,
          groups,
          permissions,
          isAuthenticated: true,
          isLoading: false,
          error: null,
          isAdmin,
          effectivePermissions: permissions,
        });
      },

      logout: () => {
        set({
          ...defaultState,
          isAdmin: false,
          effectivePermissions: [],
        });
      },

      updateUser: (userData: Partial<EnhancedUser>) => {
        const currentState = get();
        if (!currentState.user) return;

        const updatedUser = { ...currentState.user, ...userData };
        const permissions = calculateEffectivePermissions(
          updatedUser, 
          currentState.roles, 
          currentState.groups
        );
        const isAdmin = hasAdminPermissions(permissions);

        set({
          user: updatedUser,
          permissions,
          isAdmin,
          effectivePermissions: permissions,
        });
      },

      setLoading: (loading: boolean) => set({ isLoading: loading }),

      setError: (error: string | null) => set({ error }),

      hasPermission: (permission: Permission, resourceId?: string) => {
        const state = get();
        if (!state.isAuthenticated || !state.user) return false;

        // Super admin has all permissions
        if (state.permissions.includes('admin:full-access')) return true;

        // Check if user has the specific permission
        if (state.permissions.includes(permission)) {
          // For resource-specific permissions, add additional checks here
          if (resourceId && permission.includes('workstations:')) {
            // Check if user owns the workstation or has manage-all permission
            return state.permissions.includes('workstations:manage-all');
          }
          return true;
        }

        return false;
      },

      hasAnyPermission: (permissions: Permission[]) => {
        const state = get();
        return permissions.some(permission => state.hasPermission(permission));
      },

      hasRole: (roleId: string) => {
        const state = get();
        return state.user?.roleIds.includes(roleId) ?? false;
      },

      isInGroup: (groupId: string) => {
        const state = get();
        return state.user?.groupIds.includes(groupId) ?? false;
      },

      // Computed properties - initialized in login
      isAdmin: false,
      effectivePermissions: [],
    }),
    {
      name: 'auth-store',
      version: 1, // Increment version to trigger migration
      partialize: (state) => ({
        user: state.user,
        roles: state.roles,
        groups: state.groups,
        permissions: state.permissions,
        isAuthenticated: state.isAuthenticated,
        isAdmin: state.isAdmin,
        effectivePermissions: state.effectivePermissions,
      }),
      onRehydrateStorage: () => (state) => {
        // Recalculate permissions and isAdmin after hydration from localStorage
        // This ensures the admin flag is correctly set even if roles have changed
        if (state?.user && state?.isAuthenticated) {
          // If roles array is empty but user has roleIds, create default role objects
          let roles = state.roles || [];
          if (roles.length === 0 && state.user.roleIds && state.user.roleIds.length > 0) {
            roles = state.user.roleIds.map((roleId: string) => ({
              id: roleId,
              name: roleId.charAt(0).toUpperCase() + roleId.slice(1),
              description: `Default ${roleId} role`,
              permissions: SYSTEM_ROLES[roleId] || SYSTEM_ROLES['user'] || [],
              isSystem: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              createdBy: 'system',
            }));
            state.roles = roles;
          }
          
          const permissions = calculateEffectivePermissions(
            state.user,
            roles,
            state.groups || []
          );
          const isAdmin = hasAdminPermissions(permissions);
          
          // Update the state with recalculated values
          state.permissions = permissions;
          state.isAdmin = isAdmin;
          state.effectivePermissions = permissions;
        }
      },
    }
  )
);

// Helper functions
function calculateEffectivePermissions(
  user: EnhancedUser,
  roles: Role[],
  groups: Group[]
): Permission[] {
  const permissions = new Set<Permission>();

  // Add direct permissions
  user.directPermissions?.forEach(p => permissions.add(p));

  // Add permissions from roles
  user.roleIds.forEach(roleId => {
    const role = roles.find(r => r.id === roleId);
    if (role) {
      role.permissions.forEach(p => permissions.add(p));
    }
  });

  // Add permissions from groups (through their roles)
  user.groupIds.forEach(groupId => {
    const group = groups.find(g => g.id === groupId);
    if (group) {
      group.roleIds.forEach(roleId => {
        const role = roles.find(r => r.id === roleId);
        if (role) {
          role.permissions.forEach(p => permissions.add(p));
        }
      });
    }
  });

  return Array.from(permissions);
}

function hasAdminPermissions(permissions: Permission[]): boolean {
  return permissions.includes('admin:full-access') ||
         permissions.includes('workstations:manage-all') ||
         (permissions.includes('users:write') && permissions.includes('users:delete'));
}

// Permission checking utilities
export const checkPermission = (
  user: EnhancedUser | null,
  permission: Permission,
  roles: Role[] = [],
  groups: Group[] = []
): boolean => {
  if (!user) return false;
  
  const permissions = calculateEffectivePermissions(user, roles, groups);
  return permissions.includes('admin:full-access') || permissions.includes(permission);
};

export const checkResourceOwnership = (
  user: EnhancedUser | null,
  resourceUserId: string,
  permissions: Permission[]
): boolean => {
  if (!user) return false;
  
  // User can access their own resources
  if (user.id === resourceUserId) return true;
  
  // Or if they have admin permissions
  return permissions.includes('admin:full-access') || 
         permissions.includes('workstations:manage-all');
};