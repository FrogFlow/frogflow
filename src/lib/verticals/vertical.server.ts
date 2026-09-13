import type { Locale } from "../i18n";
import { VERTICALS, type Vertical } from "./registry";

export interface VerticalDef {
  id: Vertical;
  botDescriptionIntro: string;
  shortDescription: string;
  locales: Record<Locale, {
    contactBtn: string;
    instructionDefaultCaption: string;
    instructionComingSoon: string;
  }>;
}

export function currentVertical(): Vertical {
  const v = process.env.VERTICAL || "default";
  return (VERTICALS as readonly string[]).includes(v) ? (v as Vertical) : "default";
}

export function currentVerticalDef(): VerticalDef {
  const v = currentVertical();
  if (v === "consultant") {
    return {
      id: "consultant",
      botDescriptionIntro: "AI Consultant Bot",
      shortDescription: "Your AI assistant.",
      locales: {
        ru: {
          contactBtn: "Связаться с менеджером",
          instructionDefaultCaption: "Инструкция",
          instructionComingSoon: "Инструкция скоро появится",
        },
        en: {
          contactBtn: "Contact Manager",
          instructionDefaultCaption: "Instruction",
          instructionComingSoon: "Instruction coming soon",
        },
        kz: {
          contactBtn: "Менеджермен байланысу",
          instructionDefaultCaption: "Нұсқаулық",
          instructionComingSoon: "Нұсқаулық жақында шығады",
        },
      }
    };
  }
  
  // Default fallback
  return {
    id: "default",
    botDescriptionIntro: "Standard Bot",
    shortDescription: "A standard ecommerce bot.",
    locales: {
      ru: {
        contactBtn: "Связаться",
        instructionDefaultCaption: "Инструкция",
        instructionComingSoon: "Скоро",
      },
      en: {
        contactBtn: "Contact",
        instructionDefaultCaption: "Instruction",
        instructionComingSoon: "Coming soon",
      },
      kz: {
        contactBtn: "Байланыс",
        instructionDefaultCaption: "Нұсқаулық",
        instructionComingSoon: "Жақында",
      },
    }
  };
}
