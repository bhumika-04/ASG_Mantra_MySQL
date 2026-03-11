'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/loading';
import {
  BarChart3,
  Package,
  TrendingUp,
  Lock,
  Mail,
  Eye,
  EyeOff,
} from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const { user, isLoading, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && user) {
      router.push('/dashboard');
    }
  }, [user, isLoading, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoggingIn(true);

    try {
      const result = await login(email, password);
      if (!result.success) {
        setError(result.error || 'Login failed');
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Spinner size="lg" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const features = [
    {
      icon: BarChart3,
      title: 'Sales Analytics',
      description: 'Track sales across Amazon, Blinkit, and more',
    },
    {
      icon: Package,
      title: 'Inventory Management',
      description: 'Real-time stock levels and dispatch tracking',
    },
    {
      icon: TrendingUp,
      title: 'Growth Insights',
      description: 'Data-driven decisions for your business',
    },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Branding & Features */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary/90 to-primary flex-col justify-between p-12 text-white">
        <div>
          {/* Logo */}
          <div className="flex items-center gap-3 mb-16">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
              <svg width="28" height="28" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 12H30V16H22V30H18V16H10V12Z" fill="white"/>
                <rect x="26" y="22" width="4" height="8" rx="1" fill="white" opacity="0.7"/>
                <rect x="26" y="26" width="4" height="4" rx="1" fill="white"/>
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold">ASG Mantra</h1>
              <p className="text-white/70 text-sm">Sales Dashboard</p>
            </div>
          </div>

          {/* Headline */}
          <div className="mb-12">
            <h2 className="text-4xl font-bold leading-tight mb-4">
              Unified Commerce <br />Intelligence Platform
            </h2>
            <p className="text-white/80 text-lg">
              Consolidate your multi-channel sales data. Track inventory.
              Make smarter decisions.
            </p>
          </div>

          {/* Features */}
          <div className="space-y-6">
            {features.map((feature, index) => (
              <div key={index} className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/20">
                  <feature.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{feature.title}</h3>
                  <p className="text-white/70 text-sm">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-white/60 text-sm">
          Trusted by merchants across India
        </div>
      </div>

      {/* Right Panel - Login */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="flex items-center justify-center gap-3 mb-8 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <svg width="28" height="28" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 12H30V16H22V30H18V16H10V12Z" fill="currentColor"/>
                <rect x="26" y="22" width="4" height="8" rx="1" fill="currentColor" opacity="0.7"/>
                <rect x="26" y="26" width="4" height="4" rx="1" fill="currentColor"/>
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold">ASG Mantra</h1>
              <p className="text-muted-foreground text-sm">Sales Dashboard</p>
            </div>
          </div>

          <Card className="border-0 shadow-xl">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl">Welcome back</CardTitle>
              <CardDescription>
                Sign in to access your dashboard
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="admin@techginia.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="password" className="text-sm font-medium">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 pr-10"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={isLoggingIn}
                >
                  {isLoggingIn ? (
                    <>
                      <Spinner size="sm" className="mr-2" />
                      Signing in...
                    </>
                  ) : (
                    'Sign in'
                  )}
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Or</span>
                  </div>
                </div>

                {process.env.NODE_ENV === 'development' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setEmail('admin@techginia.com');
                      setPassword('Admin@123');
                    }}
                    disabled={isLoggingIn}
                  >
                    Use Demo Credentials
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Mobile Features */}
          <div className="mt-8 lg:hidden">
            <div className="grid grid-cols-3 gap-4 text-center">
              {features.map((feature, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex h-10 w-10 mx-auto items-center justify-center rounded-lg bg-primary/10">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <p className="text-xs text-muted-foreground">{feature.title}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
