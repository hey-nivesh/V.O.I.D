import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authAPI } from '../api/client';

interface User {
    id: string;
    username: string;
    role: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Check for existing token on mount
    useEffect(() => {
        const storedToken = localStorage.getItem('void_token');
        if (storedToken) {
            setToken(storedToken);
            // Validate token by fetching user info
            authAPI.me().then((response) => {
                if (response.success && response.data?.user) {
                    setUser(response.data.user);
                } else {
                    // Token invalid, clear it
                    localStorage.removeItem('void_token');
                    setToken(null);
                }
                setIsLoading(false);
            });
        } else if (import.meta.env.DEV) {
            // "Remove Auth" request: Auto-login as admin for dev convenience
            console.log('🔌 Auto-logging in as admin...');
            authAPI.login('admin', 'adminpass').then((response) => {
        } else {
            setIsLoading(false);
                if (response.success && response.data) {
                    const { token: newToken, user: userData } = response.data;
                    localStorage.setItem('void_token', newToken);
                    setToken(newToken);
                    setUser(userData);
                    console.log('✅ Auto-login successful');
                } else {
                    console.error('❌ Auto-login failed', response.error);
                }
                setIsLoading(false);
            });
        }
    }, []);

    const login = async (username: string, password: string) => {
        const response = await authAPI.login(username, password);

        if (response.success && response.data) {
            const { token: newToken, user: userData } = response.data;
            localStorage.setItem('void_token', newToken);
            setToken(newToken);
            setUser(userData);
            return { success: true };
        }

        return { success: false, error: response.error || 'Login failed' };
    };

    const logout = () => {
        localStorage.removeItem('void_token');
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
