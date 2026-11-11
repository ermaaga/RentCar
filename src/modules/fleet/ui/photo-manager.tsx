"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type ReactNode } from "react";

import { formatMessage, getTranslator, type MessageKey } from "../../../i18n";
import { Alert } from "../../../ui/alert";
import { uploadPhoto, type UploadOutcome, type UploadTarget } from "./photo-upload";

// FLT-07/09/10 on the vehicle detail page (admin, writable tenant): pick one or more images, they are
// uploaded one by one with progress announced, then the server list is refreshed.

export interface ManagedPhoto {
  id: string;
  small: string;
  isCover: boolean;
  /** Cover and delete forms, rendered by the page (server actions bound to this photo). */
  controls: ReactNode;
}

type Status =
  { kind: "idle" } | { kind: "busy"; n: number; total: number } | { kind: UploadOutcome };

const outcomeKey = (o: UploadOutcome): MessageKey =>
  o === "ok" ? "vehicles.photos.uploaded" : (`vehicles.photos.error.${o}` as MessageKey);

function UploadStatus({ status }: { status: Status }) {
  const t = getTranslator();
  return (
    <div aria-live="polite">
      {status.kind === "busy" ? (
        <p>{formatMessage(t("vehicles.photos.uploading"), { n: status.n, total: status.total })}</p>
      ) : null}
      {status.kind !== "idle" && status.kind !== "busy" ? (
        <Alert kind={status.kind === "ok" ? "status" : "error"}>{t(outcomeKey(status.kind))}</Alert>
      ) : null}
    </div>
  );
}

function Uploader(props: { target: UploadTarget }) {
  const t = getTranslator();
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    let last: UploadOutcome = "ok";
    for (const [i, file] of files.entries()) {
      setStatus({ kind: "busy", n: i + 1, total: files.length });
      last = await uploadPhoto(props.target, file);
      if (last !== "ok") break;
    }
    setStatus({ kind: last });
    router.refresh();
  }
  const busy = status.kind === "busy";
  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-12 w-fit cursor-pointer items-center rounded-md bg-primary px-4 font-semibold text-primary-foreground has-[:disabled]:opacity-60">
        {t("vehicles.photos.choose")}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={busy}
          onChange={(e) => void onChange(e)}
          className="sr-only"
        />
      </label>
      <UploadStatus status={status} />
    </div>
  );
}

function PhotoItem(props: { photo: ManagedPhoto; alt: string }) {
  const t = getTranslator();
  const p = props.photo;
  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-3">
      <img
        src={p.small}
        alt={props.alt}
        width={480}
        height={360}
        className="aspect-[4/3] w-full rounded-md object-cover"
      />
      {p.isCover ? <p className="font-semibold">{t("vehicles.photos.cover")}</p> : null}
      {p.controls}
    </li>
  );
}

export function PhotoManager(props: {
  vehicleName: string;
  target: UploadTarget;
  photos: readonly ManagedPhoto[];
}) {
  const t = getTranslator();
  return (
    <section aria-labelledby="photos-title" className="mt-8 flex flex-col gap-4">
      <h2 id="photos-title" className="text-xl font-semibold">
        {t("vehicles.photos.title")}
      </h2>
      <p className="text-muted-foreground">{t("vehicles.photos.intro")}</p>
      {props.photos.length < 10 ? <Uploader target={props.target} /> : null}
      {props.photos.length === 0 ? <p>{t("vehicles.photos.empty")}</p> : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {props.photos.map((p, i) => (
          <PhotoItem
            key={p.id}
            photo={p}
            alt={formatMessage(t("vehicles.photos.alt"), { n: i + 1, name: props.vehicleName })}
          />
        ))}
      </ul>
    </section>
  );
}
