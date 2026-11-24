import fs from "fs";
import path from "path";

interface FirebaseAppletConfig {
  apiKey?: string;
  projectId?: string;
  storageBucket?: string;
  firestoreDatabaseId?: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;

export function getFirebaseAppletConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;
  try {
    const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    cachedConfig = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    cachedConfig = {};
  }
  return cachedConfig || {};
}

export function encodeFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    return Number.isInteger(val)
      ? { integerValue: String(val) }
      : { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((item) => encodeFirestoreValue(item)),
      },
    };
  }
  if (typeof val === "object") {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function decodeFirestoreValue(val: any): any {
  if (!val || typeof val !== "object") return undefined;
  if ("stringValue" in val) return val.stringValue;
  if ("integerValue" in val) return Number(val.integerValue);
  if ("doubleValue" in val) return Number(val.doubleValue);
  if ("booleanValue" in val) return Boolean(val.booleanValue);
  if ("timestampValue" in val) return val.timestampValue;
  if ("nullValue" in val) return null;
  if ("arrayValue" in val) {
    return Array.isArray(val.arrayValue?.values)
      ? val.arrayValue.values.map(decodeFirestoreValue)
      : [];
  }
  if ("mapValue" in val) {
    const obj: Record<string, any> = {};
    const fields = val.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = decodeFirestoreValue(v);
    }
    return obj;
  }
  return undefined;
}

export function decodeFirestoreDocument(docJson: any): Record<string, any> {
  const out: Record<string, any> = {};
  const fields = docJson?.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  if (typeof docJson?.name === "string") {
    const id = docJson.name.split("/").pop();
    if (id && !out.id) out.id = id;
  }
  return out;
}

function getFirestoreBaseUrl(): string {
  const cfg = getFirebaseAppletConfig();
  const projectId = cfg.projectId;
  if (!projectId) {
    throw new Error("Firebase projectId is missing in firebase-applet-config.json.");
  }
  const databaseId =
    typeof cfg.firestoreDatabaseId === "string" && cfg.firestoreDatabaseId.trim()
      ? cfg.firestoreDatabaseId.trim()
      : "(default)";
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(databaseId)}/documents`;
}

export async function fsReadDocWithMeta(
  docPath: string,
  bearerToken?: string
): Promise<{ data: Record<string, any>; updateTime?: string } | null> {
  const url = `${getFirestoreBaseUrl()}/${docPath}`;
  const headers: Record<string, string> = {};
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const resp = await fetch(url, { headers });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Firestore read failed (${resp.status}) for ${docPath}: ${errText.slice(0, 160)}`);
  }
  const json = await resp.json();
  return {
    data: decodeFirestoreDocument(json),
    updateTime: typeof json?.updateTime === "string" ? json.updateTime : undefined,
  };
}

export async function fsReadDoc(
  docPath: string,
  bearerToken?: string
): Promise<Record<string, any> | null> {
  const res = await fsReadDocWithMeta(docPath, bearerToken);
  return res ? res.data : null;
}

export async function fsListCollection(
  collectionPath: string,
  bearerToken?: string,
  pageSize = 200
): Promise<Array<Record<string, any> & { id: string }>> {
  const url = `${getFirestoreBaseUrl()}/${collectionPath}?pageSize=${Math.min(300, Math.max(1, pageSize))}`;
  const headers: Record<string, string> = {};
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const resp = await fetch(url, { headers });
  if (resp.status === 404) return [];
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Firestore list failed (${resp.status}) for ${collectionPath}: ${errText.slice(0, 160)}`);
  }
  const json = await resp.json();
  const docs = Array.isArray(json?.documents) ? json.documents : [];
  return docs.map((d: any) => {
    const decoded = decodeFirestoreDocument(d);
    const id = typeof d?.name === "string" ? d.name.split("/").pop() || "" : decoded.id || "";
    return { ...decoded, id };
  });
}

export async function fsSetDoc(
  docPath: string,
  data: Record<string, any>,
  bearerToken?: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = `${getFirestoreBaseUrl()}/${docPath}`;
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) fields[k] = encodeFirestoreValue(v);
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const resp = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, error: errText.slice(0, 200) };
  }
  return { ok: true, status: resp.status };
}

export async function fsPatchFields(
  docPath: string,
  fieldsObj: Record<string, any>,
  fieldPaths: string[],
  bearerToken?: string,
  expectedUpdateTime?: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  const params = new URLSearchParams();
  for (const fp of fieldPaths) {
    params.append("updateMask.fieldPaths", fp);
  }
  if (expectedUpdateTime) {
    params.append("currentDocument.updateTime", expectedUpdateTime);
  }
  const url = `${getFirestoreBaseUrl()}/${docPath}?${params.toString()}`;
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(fieldsObj)) {
    if (v !== undefined) fields[k] = encodeFirestoreValue(v);
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const resp = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, error: errText.slice(0, 200) };
  }
  return { ok: true, status: resp.status };
}

export async function fsDeleteDoc(
  docPath: string,
  bearerToken?: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = `${getFirestoreBaseUrl()}/${docPath}`;
  const headers: Record<string, string> = {};
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const resp = await fetch(url, { method: "DELETE", headers });
  if (!resp.ok && resp.status !== 404) {
    const errText = await resp.text().catch(() => "");
    return { ok: false, status: resp.status, error: errText.slice(0, 200) };
  }
  return { ok: true, status: resp.status };
}
