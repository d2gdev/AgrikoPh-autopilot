"use client";

const ODYSSEUS_URL =
  process.env.NEXT_PUBLIC_ODYSSEUS_URL ??
  "https://pewdiepie-archdaemon.github.io/odysseus/";

export default function OdysseusPage() {
  return (
    <div style={{ position: "relative", width: "100%", height: "calc(100vh - 56px)" }}>
      <iframe
        src={ODYSSEUS_URL}
        style={{ width: "100%", height: "100%", border: "none", display: "block" }}
        allow="clipboard-read; clipboard-write"
        title="Odysseus Workspace"
      />
    </div>
  );
}
