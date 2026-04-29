import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

export function useAuth() {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [userPlan, setUserPlan] = useState<string>('free');

    useEffect(() => {
        if (!supabase) {
            setLoading(false);
            return;
        }

        const fetchPlan = async (userId: string) => {
            try {
                const { data } = await supabase!
                    .from('profiles')
                    .select('plan')
                    .eq('id', userId)
                    .single();
                setUserPlan(data?.plan || 'free');
            } catch (err) {
                console.error("Error fetching user plan:", err);
            }
        };

        // Reactive listener for all subsequent auth changes (sign in, sign out, token refresh).
        // Never touches `loading` — that's getSession()'s exclusive job.
        const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchPlan(session.user.id);
            } else {
                setUserPlan('free');
            }
        });

        // Single loading gate: `loading` only becomes false after getSession() resolves.
        // This prevents any redirect from firing before the persisted session is confirmed.
        supabase!.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                fetchPlan(session.user.id).finally(() => setLoading(false));
            } else {
                setLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const signOut = async () => {
        await supabase!.auth.signOut();
    };

    return {
        user,
        session,
        loading,
        userPlan,
        signOut
    };
}
