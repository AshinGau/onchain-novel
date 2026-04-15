"use client";

type TxStatus = "idle" | "confirming" | "waiting" | "success" | "error";

export function TxStatusLabel({
  status,
  error,
  successText = "Done!",
}: {
  status: TxStatus;
  error?: string | null;
  successText?: string;
}) {
  if (status === "success") return <span className="text-success">✓ {successText}</span>;
  if (status === "error" && error) return <span className="text-danger">{error}</span>;
  return null;
}

export function txButtonLabel(status: TxStatus, idleText: string, successText = "Done"): string {
  if (status === "confirming") return "Confirm in wallet…";
  if (status === "waiting") return "Waiting…";
  if (status === "success") return `${successText} ✓`;
  return idleText;
}
