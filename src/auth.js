import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";

export function signUp({ email, password, username, troupe, ville }) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { username, troupe, ville } },
  });
}

export function signIn({ email, password }) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signOut() {
  return supabase.auth.signOut();
}

// Suit la session Supabase Auth (persistée automatiquement par le SDK, survit à un rechargement de
// page) et charge le profil associé (nom d'utilisateur, troupe, ville, is_admin) une fois connecté·e.
// `loading` reste true tant que la réponse initiale de Supabase sur la session en cours n'est pas
// arrivée, pour éviter un flash "déconnecté" au chargement de l'appli.
export function useAuthUser() {
  const [session, setSession] = useState(undefined); // undefined = pas encore résolu, null = pas connecté
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("username, troupe, ville, is_admin")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setProfile(data); });
    return () => { cancelled = true; };
  }, [session]);

  return {
    loading: session === undefined,
    session,
    profile,
    currentUser: profile?.username ?? null,
    isAdmin: profile?.is_admin === true,
  };
}
