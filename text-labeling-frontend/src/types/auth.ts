// src/types/auth.ts

export interface User {
    id: string;
    email: string;
    full_name: string;
    avatar_url: string | null;
    roles: string[];
    status: string;
    created_at: string;
  }
  
  export interface LoginResponse {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    user: User;
  }
  
  export interface AuthState {
    token: string | null;
    refreshToken: string | null;
    user: User | null;
    isAuthenticated: boolean;
    isInitialized: boolean;
  
    // Actions
    setAuth: (token: string, refreshToken: string, user: User) => void;
    setUser: (user: User) => void;
    logout: () => void;
    initialize: () => void;
  }
