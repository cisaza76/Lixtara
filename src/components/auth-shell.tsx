import { type ReactNode } from "react";

interface Props {
  eyebrow: string;
  titleBefore: string;
  titleAccent: string;
  titleAfter: string;
  children: ReactNode;
}

export function AuthShell({
  eyebrow,
  titleBefore,
  titleAccent,
  titleAfter,
  children,
}: Props) {
  return (
    <main className="bg-background text-foreground flex-1 flex items-center justify-center px-6 py-24 lg:py-32">
      <div className="w-full max-w-md flex flex-col gap-10">
        <div className="flex flex-col gap-4 items-start">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
            {eyebrow}
          </p>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.05] tracking-tight text-ink font-normal">
            {titleBefore}
            <em className="italic text-gold">{titleAccent}</em>
            {titleAfter}
          </h1>
        </div>
        {children}
      </div>
    </main>
  );
}

interface FieldProps {
  label: string;
  name: string;
  type?: "email" | "password" | "text";
  required?: boolean;
  defaultValue?: string;
  autoComplete?: string;
  help?: string;
}

export function Field({
  label,
  name,
  type = "text",
  required = true,
  defaultValue,
  autoComplete,
  help,
}: FieldProps) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        className="bg-transparent border-b border-gold-soft focus:border-gold outline-none py-2 text-base text-ink"
      />
      {help && (
        <span className="text-xs text-ink/50">{help}</span>
      )}
    </label>
  );
}

export function SubmitButton({
  children,
  name,
  value,
}: {
  children: ReactNode;
  name?: string;
  value?: string;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className="inline-flex items-center justify-center px-10 py-4 bg-ink text-ivory text-xs font-medium tracking-[0.2em] uppercase hover:bg-ink/85 transition-colors mt-2"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  name,
  value,
}: {
  children: ReactNode;
  name?: string;
  value?: string;
}) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className="inline-flex items-center justify-center px-10 py-4 bg-transparent text-ink text-xs font-medium tracking-[0.2em] uppercase border border-gold-soft hover:border-gold hover:text-gold transition-colors mt-2"
    >
      {children}
    </button>
  );
}

interface TextareaFieldProps {
  label: string;
  name: string;
  defaultValue?: string;
  rows?: number;
  required?: boolean;
  help?: string;
}

export function TextareaField({
  label,
  name,
  defaultValue,
  rows = 5,
  required = true,
  help,
}: TextareaFieldProps) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
        {label}
      </span>
      <textarea
        name={name}
        defaultValue={defaultValue}
        rows={rows}
        required={required}
        className="bg-transparent border border-gold-soft focus:border-gold outline-none px-3 py-2 text-base text-ink leading-relaxed resize-y"
      />
      {help && <span className="text-xs text-ink/50">{help}</span>}
    </label>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="border border-gold-soft bg-ivory-strong px-4 py-3 text-sm text-ink/80">
      {message}
    </div>
  );
}
