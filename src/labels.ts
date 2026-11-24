import type { Kind, Status } from "./data";
import { t } from "./i18n";

export const KIND: Record<Kind, string> = { food: t("食"), sight: t("景"), hotel: t("宿"), shop: t("買"), move: t("移") };
export const KIND_NAME: Record<Kind, string> = { food: t("餐廳"), sight: t("景點"), hotel: t("住宿"), shop: t("購物"), move: t("交通") };
export const SEAL: Record<Status, string> = { ok: t("已訂"), todo: t("要訂"), tbd: t("待定") };
