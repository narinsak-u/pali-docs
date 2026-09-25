import type { LucideIcon } from "lucide-react";

export interface ContentIcon {
  icon: LucideIcon;
}

export interface ContentDescription {
  short: string;
  long?: string;
}

export interface QuizTopic {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  amount: number;
  time: number;
  icon: LucideIcon;
}

export interface NavItem {
  id: string;
  title: string;
  href: string;
  icon?: LucideIcon;
  children?: NavItem[];
}

export interface DocNode {
  id: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  children?: DocNode[];
}