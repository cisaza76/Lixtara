// Placeholder for admin pages whose backing tables / features land in a later
// phase of the admin-panel build.

export function AdminComingSoon({
  title,
  note,
}: {
  title: string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-display text-3xl text-ink font-normal">{title}</h1>
      <div className="border border-gold-soft bg-ivory-strong/40 p-8 flex flex-col gap-2 max-w-2xl">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          Coming soon
        </p>
        <p className="text-sm text-ink/70 leading-relaxed">
          {note ??
            "This section is part of the admin-panel build and ships in an upcoming phase."}
        </p>
      </div>
    </div>
  );
}
