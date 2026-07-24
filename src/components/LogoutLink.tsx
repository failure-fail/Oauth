"use client";

import { useRouter } from "next/navigation";

export function LogoutLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="nav-link-btn"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/");
        router.refresh();
      }}
    >
      Log out
    </button>
  );
}
