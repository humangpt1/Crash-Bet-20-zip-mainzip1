import crypto from "crypto";

const MEGAPAY_BASE = "https://megapay.co.ke/backend/v1";

export interface MegaPayConfig {
  apiKey: string;
  email: string;
}

export function getMegaPayConfig(): MegaPayConfig | null {
  const apiKey = process.env.MEGAPAY_API_KEY;
  const email = process.env.MEGAPAY_EMAIL;
  if (!apiKey || !email) return null;
  return { apiKey, email };
}

export interface InitiateStkPushArgs {
  amount: number; // KES whole units
  msisdn: string; // 254XXXXXXXXX
  reference: string;
}

export interface InitiateStkPushResult {
  success: boolean;
  message: string;
  transactionRequestId?: string;
  raw: any;
}

/**
 * Initiate an M-Pesa STK Push via MegaPay.
 * NOTE: amount is whole KES (the API does not accept decimals).
 */
export async function initiateStkPush(
  args: InitiateStkPushArgs,
): Promise<InitiateStkPushResult> {
  const cfg = getMegaPayConfig();
  if (!cfg) {
    throw new Error("MegaPay credentials not configured");
  }

  const body = {
    api_key: cfg.apiKey,
    email: cfg.email,
    amount: String(args.amount),
    msisdn: args.msisdn,
    reference: args.reference,
  };

  const res = await fetch(`${MEGAPAY_BASE}/initiatestk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let raw: any = null;
  try {
    raw = await res.json();
  } catch {
    raw = { error: "Non-JSON response", status: res.status };
  }

  // MegaPay quirk: success key is the string "200" and the typo "massage".
  const ok =
    raw &&
    (raw.success === "200" ||
      raw.success === 200 ||
      raw.ResponseCode === 0 ||
      raw.ResponseCode === "0");

  return {
    success: ok,
    message: raw?.massage || raw?.message || raw?.ResponseDescription || "",
    transactionRequestId: raw?.transaction_request_id,
    raw,
  };
}

export interface TransactionStatusResult {
  status: "pending" | "success" | "failed" | "unknown";
  receipt?: string;
  amount?: number;
  msisdn?: string;
  raw: any;
}

export async function checkTransactionStatus(
  transactionRequestId: string,
): Promise<TransactionStatusResult> {
  const cfg = getMegaPayConfig();
  if (!cfg) throw new Error("MegaPay credentials not configured");

  const body = {
    api_key: cfg.apiKey,
    email: cfg.email,
    transaction_request_id: transactionRequestId,
  };

  const res = await fetch(`${MEGAPAY_BASE}/transactionstatus`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let raw: any = null;
  try {
    raw = await res.json();
  } catch {
    raw = { error: "Non-JSON response", status: res.status };
  }

  const txStatus = (raw?.TransactionStatus || "").toString().toLowerCase();
  let status: TransactionStatusResult["status"] = "unknown";
  if (txStatus === "completed" || raw?.TransactionCode === "0") status = "success";
  else if (txStatus === "pending") status = "pending";
  else if (txStatus === "failed" || txStatus === "cancelled") status = "failed";

  return {
    status,
    receipt: raw?.TransactionReceipt,
    amount: raw?.TransactionAmount ? Number(raw.TransactionAmount) : undefined,
    msisdn: raw?.Msisdn,
    raw,
  };
}

/**
 * Generate a unique reference for a deposit/withdrawal request.
 */
export function makeReference(prefix: string, userId: number): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString("hex");
  return `${prefix}-${userId}-${ts}-${rand}`.toUpperCase();
}
