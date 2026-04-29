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

        // onAuthStateChange fires INITIAL_SESSION on mount with the persisted session.
        // This is the single source of truth — no getSession() race condition.
        const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchPlan(session.user.id).finally(() => setLoading(false));
            } else {
                setUserPlan('free');
                // Only stop the initial load gate after the session is determined.
                // INITIAL_SESSION with null means genuinely not logged in.
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
