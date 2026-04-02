"use client";

import { Button } from "@/components/ui/button";

export function ComingSoonButton({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Button
      variant="outline"
      className={`opacity-60 ${className || ""}`}
      onClick={() => alert("Coming Soon")}
    >
      {children}
    </Button>
  );
}
