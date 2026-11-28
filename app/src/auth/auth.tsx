/**
 * Sign-in. With VITE_CLERK_PUBLISHABLE_KEY set, Clerk handles it and the sync
 * server checks the token. Without it, the app runs in DEV mode: you pick a
 * name and anyone can join. DEV mode is for local testing only.
 */
import { ClerkProvider, SignInButton, SignedIn, SignedOut, UserButton, useAuth, useUser } from "@clerk/clerk-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { newId } from "@/doc/ids";

export interface Me {
  id: string;
  name: string;
  getToken: () => Promise<string>;
  devMode: boolean;
}

const MeContext = createContext<Me | null>(null);
export const useMe = () => {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside AuthGate");
  return me;
};

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

export function AuthGate({ children }: { children: ReactNode }) {
  if (clerkKey) {
    return (
      <ClerkProvider publishableKey={clerkKey}>
        <SignedOut>
          <Centered>
            <h1 className="text-2xl font-semibold">OASIS</h1>
            <SignInButton mode="modal">
              <button className="btn-primary">Sign in</button>
            </SignInButton>
          </Centered>
        </SignedOut>
        <SignedIn>
          <ClerkMe>{children}</ClerkMe>
        </SignedIn>
      </ClerkProvider>
    );
  }
  return <DevMe>{children}</DevMe>;
}

function ClerkMe({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const me = useMemo<Me>(
    () => ({
      id: user?.id ?? "unknown",
      name: user?.username ?? user?.firstName ?? user?.primaryEmailAddress?.emailAddress.split("@")[0] ?? "Someone",
      getToken: async () => (await getToken()) ?? "",
      devMode: false,
    }),
    [user, getToken],
  );
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function AccountButton() {
  if (!clerkKey) return <span className="text-xs text-amber-400" title="No sign-in: anyone with the link can join. For local testing only.">DEV</span>;
  return <UserButton />;
}

const NAME_KEY = "oasis.devName";
const ID_KEY = "oasis.devId";

function readStored(key: string) {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

function DevMe({ children }: { children: ReactNode }) {
  const [name, setName] = useState(() => readStored(NAME_KEY) ?? "");
  const [draft, setDraft] = useState(name);
  // Per tab, so two tabs on one machine show up as two people.
  const [id] = useState(() => {
    const existing = (() => { try { return sessionStorage.getItem(ID_KEY); } catch { return null; } })();
    const fresh = existing ?? `dev-${newId(8)}`;
    try { sessionStorage.setItem(ID_KEY, fresh); } catch { /* storage blocked */ }
    return fresh;
  });
  const me = useMemo<Me>(() => ({ id, name, getToken: async () => "dev", devMode: true }), [id, name]);

  if (!name) {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">OASIS</h1>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = draft.trim().slice(0, 32);
            if (!n) return;
            try { sessionStorage.setItem(NAME_KEY, n); localStorage.setItem(NAME_KEY, n); } catch { /* storage blocked */ }
            setName(n);
          }}
        >
          <input
            aria-label="Your name"
            autoFocus
            className="input"
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Your name"
            value={draft}
          />
          <button className="btn-primary" type="submit">Continue</button>
        </form>
        <p className="text-xs text-neutral-400">DEV mode: no sign-in. Set VITE_CLERK_PUBLISHABLE_KEY to use Clerk.</p>
      </Centered>
    );
  }
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4">{children}</div>;
}
