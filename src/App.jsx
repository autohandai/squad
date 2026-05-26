import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ArrowLeft,
  BadgeCheck,
  Ban,
  Bot,
  Boxes,
  Brain,
  BrainCog,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  CircleUserRound,
  ClipboardCheck,
  Code2,
  Command,
  Database,
  Clock3,
  Ellipsis,
  FileCode2,
  Folder,
  FolderGit2,
  Folders,
  Gauge,
  GitBranch,
  Globe2,
  Hammer,
  History,
  KeyRound,
  Languages,
  LayoutList,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareText,
  Monitor,
  Moon,
  Palette,
  PauseCircle,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  TerminalSquare,
  Trash2,
  Unplug,
  Upload,
  UserRound,
  Webhook,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import {
  buildActivity,
  extensionRows,
  initialAgents,
  initialAutomations,
  initialMessages,
  initialTasks,
  AUTOHAND_SKILLS_REGISTRY_URL,
  builtInAvatarOptions,
  roleTemplates,
} from "./data.js";
import {
  DEFAULT_LOCALE,
  LOCALE_MODE_AUTO,
  LOCALE_MODE_MANUAL,
  SUPPORTED_LOCALES,
  detectSystemLocale,
  formatCopy,
  formatLocaleMenuLabel,
  formatLocaleSummary,
  formatLocalizedNumber,
  getLocaleCopy,
  getLocaleDirection,
  getNavigatorLanguages,
  resolveLocalePreference,
  resolveSupportedLocale,
} from "./locales.js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./styles.css";

class RenderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background p-6 text-foreground">
          <Alert variant="destructive" className="mx-auto max-w-3xl">
            <AlertTriangle />
            <AlertTitle>Autohand Squad could not render</AlertTitle>
            <AlertDescription>{this.state.error.message}</AlertDescription>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}

const STORAGE_KEYS = {
  agents: "autohandSquad.v1.agents",
  automations: "autohandSquad.v1.automations",
  locale: "autohandSquad.v1.locale",
  handoffSettings: "autohandSquad.v1.handoffSettings",
  messages: "autohandSquad.v1.messages",
  sidebarCollapsed: "autohandSquad.v1.sidebarCollapsed",
  tasks: "autohandSquad.v1.tasks",
  theme: "autohandSquad.v1.theme",
};

const ACCOUNT_PROFILE = {
  initials: "I",
  name: "Igor Costa",
};

const SKILL_ALIASES = {
  "a11y-check": "web-design-guidelines",
  "accessibility-audit": "web-design-guidelines",
  "browser-harness": "agent-browser",
  "browser-proof": "agent-browser",
  "change-validation-planner": "testing-strategies",
  "design-system": "react-component-architecture",
  "github-developer-communication": "git-workflow-mastery",
  responsive: "frontend-responsive-design-standards",
  "responsive-design": "frontend-responsive-design-standards",
  "test-case-template": "testing-strategies",
};

function normalizeSkillId(skill) {
  const id = String(skill || "")
    .trim()
    .replace(/^@?skill\//i, "")
    .replace(/^https:\/\/skilled\.autohand\.ai\/skill\//i, "")
    .toLowerCase();
  return SKILL_ALIASES[id] || id;
}

function normalizeSkillList(skills) {
  if (!Array.isArray(skills)) return [];
  return Array.from(new Set(skills.map(normalizeSkillId).filter(Boolean)));
}

const AVATAR_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp";
const AVATAR_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

function readAvatarFile(file, onLoad, setAvatarError, input) {
  if (!file) return;

  if (!AVATAR_UPLOAD_TYPES.has(file.type)) {
    setAvatarError("Use a PNG, JPG, or WebP avatar.");
    if (input) input.value = "";
    return;
  }

  if (file.size > AVATAR_UPLOAD_MAX_BYTES) {
    setAvatarError("Avatar must be 2 MB or smaller.");
    if (input) input.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    setAvatarError("");
    onLoad(String(reader.result || ""));
    if (input) input.value = "";
  };
  reader.onerror = () => setAvatarError("Avatar could not be read.");
  reader.readAsDataURL(file);
}

const BRAND_MARKS = {
  dark: "/brand/autohand-squad/autohand-squad-mark-dark.webp",
  light: "/brand/autohand-squad/autohand-squad-mark-light.webp",
};

const THEME_MODE_SYSTEM = "system";
const THEME_MODE_DARK = "dark";
const THEME_MODE_LIGHT = "light";
const THEME_MODES = [THEME_MODE_SYSTEM, THEME_MODE_DARK, THEME_MODE_LIGHT];
const THEME_SURFACES = [THEME_MODE_LIGHT, THEME_MODE_DARK];
const DEFAULT_THEME_PREFERENCE = {
  mode: THEME_MODE_SYSTEM,
  lightTheme: "autohand-light",
  darkTheme: "autohand-dark",
};

const THEME_TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
];

const THEME_PRESETS = {
  light: [
    {
      id: "autohand-light",
      label: "Autohand",
      description: "Bright console with green signal accents.",
      swatches: ["#ffffff", "#171717", "#5ed46f", "#f4f4f5"],
      tokens: {
        background: "#ffffff",
        foreground: "#171717",
        card: "#fafafa",
        "card-foreground": "#080a0d",
        popover: "#ffffff",
        "popover-foreground": "#080a0d",
        primary: "#5ed46f",
        "primary-foreground": "#102013",
        secondary: "#f4f4f5",
        "secondary-foreground": "#1c241f",
        muted: "#f4f4f5",
        "muted-foreground": "#737373",
        accent: "#eeeeef",
        "accent-foreground": "#101511",
        destructive: "#b83d33",
        border: "#dedede",
        input: "#dedede",
        ring: "#171717",
        "chart-1": "#5ed46f",
        "chart-2": "#3abf9f",
        "chart-3": "#f1b84b",
        "chart-4": "#6b7cff",
        "chart-5": "#e85b55",
      },
    },
    {
      id: "xcode-light",
      label: "Xcode",
      description: "Clean white surface with crisp blue focus.",
      swatches: ["#ffffff", "#1a1c1f", "#339cff", "#eef2f7"],
      tokens: {
        background: "#ffffff",
        foreground: "#1a1c1f",
        card: "#f7f8fa",
        "card-foreground": "#17191c",
        popover: "#ffffff",
        "popover-foreground": "#17191c",
        primary: "#339cff",
        "primary-foreground": "#ffffff",
        secondary: "#eef2f7",
        "secondary-foreground": "#1b2028",
        muted: "#eef2f7",
        "muted-foreground": "#646b75",
        accent: "#e5f0ff",
        "accent-foreground": "#0f315d",
        destructive: "#c7352f",
        border: "#d7dce3",
        input: "#d7dce3",
        ring: "#339cff",
        "chart-1": "#339cff",
        "chart-2": "#20a3b8",
        "chart-3": "#e6a63b",
        "chart-4": "#7b63d8",
        "chart-5": "#d94f45",
      },
    },
    {
      id: "github-light",
      label: "GitHub",
      description: "Repository-style light theme with blue actions.",
      swatches: ["#ffffff", "#24292f", "#0969da", "#f6f8fa"],
      tokens: {
        background: "#ffffff",
        foreground: "#24292f",
        card: "#f6f8fa",
        "card-foreground": "#24292f",
        popover: "#ffffff",
        "popover-foreground": "#24292f",
        primary: "#0969da",
        "primary-foreground": "#ffffff",
        secondary: "#f6f8fa",
        "secondary-foreground": "#24292f",
        muted: "#f6f8fa",
        "muted-foreground": "#57606a",
        accent: "#ddf4ff",
        "accent-foreground": "#0969da",
        destructive: "#cf222e",
        border: "#d0d7de",
        input: "#d0d7de",
        ring: "#0969da",
        "chart-1": "#0969da",
        "chart-2": "#1a7f37",
        "chart-3": "#9a6700",
        "chart-4": "#8250df",
        "chart-5": "#cf222e",
      },
    },
    {
      id: "solarized-light",
      label: "Solarized",
      description: "Soft warm light theme with balanced contrast.",
      swatches: ["#fdf6e3", "#586e75", "#268bd2", "#eee8d5"],
      tokens: {
        background: "#fdf6e3",
        foreground: "#586e75",
        card: "#eee8d5",
        "card-foreground": "#586e75",
        popover: "#fdf6e3",
        "popover-foreground": "#586e75",
        primary: "#268bd2",
        "primary-foreground": "#fdf6e3",
        secondary: "#eee8d5",
        "secondary-foreground": "#586e75",
        muted: "#eee8d5",
        "muted-foreground": "#657b83",
        accent: "#e4dcc7",
        "accent-foreground": "#073642",
        destructive: "#dc322f",
        border: "#d6cfba",
        input: "#d6cfba",
        ring: "#268bd2",
        "chart-1": "#268bd2",
        "chart-2": "#2aa198",
        "chart-3": "#b58900",
        "chart-4": "#6c71c4",
        "chart-5": "#dc322f",
      },
    },
    {
      id: "notion-light",
      label: "Notion",
      description: "Paper-white workspace style with quiet blue accents.",
      swatches: ["#fbfbfa", "#37352f", "#2383e2", "#f1f1ef"],
      tokens: {
        background: "#fbfbfa",
        foreground: "#37352f",
        card: "#ffffff",
        "card-foreground": "#37352f",
        popover: "#ffffff",
        "popover-foreground": "#37352f",
        primary: "#2383e2",
        "primary-foreground": "#ffffff",
        secondary: "#f1f1ef",
        "secondary-foreground": "#37352f",
        muted: "#f7f6f3",
        "muted-foreground": "#787774",
        accent: "#eaf3fc",
        "accent-foreground": "#0b4f8a",
        destructive: "#e03e3e",
        border: "#e5e5e2",
        input: "#e5e5e2",
        ring: "#2383e2",
        "chart-1": "#2383e2",
        "chart-2": "#0f9d58",
        "chart-3": "#d9730d",
        "chart-4": "#9b51e0",
        "chart-5": "#e03e3e",
      },
    },
    {
      id: "raycast-light",
      label: "Raycast",
      description: "Command palette energy with sharp red focus.",
      swatches: ["#f8f8fa", "#1f1f22", "#ff6363", "#ffffff"],
      tokens: {
        background: "#f8f8fa",
        foreground: "#1f1f22",
        card: "#ffffff",
        "card-foreground": "#1f1f22",
        popover: "#ffffff",
        "popover-foreground": "#1f1f22",
        primary: "#ff6363",
        "primary-foreground": "#ffffff",
        secondary: "#f0f1f4",
        "secondary-foreground": "#2b2b31",
        muted: "#f0f1f4",
        "muted-foreground": "#67676f",
        accent: "#fff0f0",
        "accent-foreground": "#8f1d1d",
        destructive: "#d93232",
        border: "#e2e3e8",
        input: "#e2e3e8",
        ring: "#ff6363",
        "chart-1": "#ff6363",
        "chart-2": "#5cc8ff",
        "chart-3": "#ffbd59",
        "chart-4": "#9b7cff",
        "chart-5": "#d93232",
      },
    },
    {
      id: "cloudflare-light",
      label: "Cloudflare",
      description: "Warm operations surface with orange infrastructure cues.",
      swatches: ["#fffaf4", "#1d1d1f", "#f6821f", "#f6efe6"],
      tokens: {
        background: "#fffaf4",
        foreground: "#1d1d1f",
        card: "#ffffff",
        "card-foreground": "#1d1d1f",
        popover: "#ffffff",
        "popover-foreground": "#1d1d1f",
        primary: "#f6821f",
        "primary-foreground": "#1d1005",
        secondary: "#f6efe6",
        "secondary-foreground": "#2b2118",
        muted: "#f6efe6",
        "muted-foreground": "#735f4b",
        accent: "#fff0df",
        "accent-foreground": "#803d00",
        destructive: "#c93c37",
        border: "#eadfD2",
        input: "#eadfD2",
        ring: "#f6821f",
        "chart-1": "#f6821f",
        "chart-2": "#faae40",
        "chart-3": "#3e7ebd",
        "chart-4": "#6f42c1",
        "chart-5": "#c93c37",
      },
    },
    {
      id: "linear-light",
      label: "Linear",
      description: "Issue-tracker calm with violet-blue precision.",
      swatches: ["#f7f8fb", "#171717", "#5e6ad2", "#edf0ff"],
      tokens: {
        background: "#f7f8fb",
        foreground: "#171717",
        card: "#ffffff",
        "card-foreground": "#171717",
        popover: "#ffffff",
        "popover-foreground": "#171717",
        primary: "#5e6ad2",
        "primary-foreground": "#ffffff",
        secondary: "#edf0ff",
        "secondary-foreground": "#222854",
        muted: "#f1f2f6",
        "muted-foreground": "#6c7280",
        accent: "#eceefe",
        "accent-foreground": "#343b8f",
        destructive: "#d54848",
        border: "#dfe2ea",
        input: "#dfe2ea",
        ring: "#5e6ad2",
        "chart-1": "#5e6ad2",
        "chart-2": "#26a69a",
        "chart-3": "#f2a93b",
        "chart-4": "#8b5cf6",
        "chart-5": "#d54848",
      },
    },
    {
      id: "vercel-light",
      label: "Vercel",
      description: "Minimal monochrome with crisp deployment contrast.",
      swatches: ["#ffffff", "#000000", "#000000", "#f5f5f5"],
      tokens: {
        background: "#ffffff",
        foreground: "#000000",
        card: "#fafafa",
        "card-foreground": "#000000",
        popover: "#ffffff",
        "popover-foreground": "#000000",
        primary: "#000000",
        "primary-foreground": "#ffffff",
        secondary: "#f5f5f5",
        "secondary-foreground": "#111111",
        muted: "#f5f5f5",
        "muted-foreground": "#666666",
        accent: "#eeeeee",
        "accent-foreground": "#000000",
        destructive: "#e5484d",
        border: "#dedede",
        input: "#dedede",
        ring: "#000000",
        "chart-1": "#000000",
        "chart-2": "#0070f3",
        "chart-3": "#f5a623",
        "chart-4": "#7928ca",
        "chart-5": "#e5484d",
      },
    },
    {
      id: "cursor-light",
      label: "Cursor",
      description: "Soft editor neutral with AI-green highlights.",
      swatches: ["#f8faf9", "#202225", "#20b486", "#eef3f0"],
      tokens: {
        background: "#f8faf9",
        foreground: "#202225",
        card: "#ffffff",
        "card-foreground": "#202225",
        popover: "#ffffff",
        "popover-foreground": "#202225",
        primary: "#20b486",
        "primary-foreground": "#042018",
        secondary: "#eef3f0",
        "secondary-foreground": "#1d2c26",
        muted: "#eef3f0",
        "muted-foreground": "#68736f",
        accent: "#e2f6ee",
        "accent-foreground": "#09573f",
        destructive: "#c84040",
        border: "#dae2df",
        input: "#dae2df",
        ring: "#20b486",
        "chart-1": "#20b486",
        "chart-2": "#3f8cff",
        "chart-3": "#e5a72f",
        "chart-4": "#8f6ee8",
        "chart-5": "#c84040",
      },
    },
  ],
  dark: [
    {
      id: "autohand-dark",
      label: "Autohand",
      description: "Black console with green signal accents.",
      swatches: ["#000000", "#faf9f5", "#8ee5a1", "#1a1a1a"],
      tokens: {
        background: "#000000",
        foreground: "#faf9f5",
        card: "#0d0d0d",
        "card-foreground": "#faf9f5",
        popover: "#0d0d0d",
        "popover-foreground": "#faf9f5",
        primary: "#8ee5a1",
        "primary-foreground": "#0d0d0d",
        secondary: "#1a1a1a",
        "secondary-foreground": "#faf9f5",
        muted: "#1a1a1a",
        "muted-foreground": "#9c9d9e",
        accent: "#242424",
        "accent-foreground": "#faf9f5",
        destructive: "#ff6f61",
        border: "#262626",
        input: "#262626",
        ring: "#8ee5a1",
        "chart-1": "#8ee5a1",
        "chart-2": "#73cd94",
        "chart-3": "#ffd06a",
        "chart-4": "#a994ff",
        "chart-5": "#ff7a72",
      },
    },
    {
      id: "ayu-dark",
      label: "Ayu",
      description: "Warm amber focus on a deep editor surface.",
      swatches: ["#0b0e14", "#bfbdb6", "#e6b450", "#11151c"],
      tokens: {
        background: "#0b0e14",
        foreground: "#bfbdb6",
        card: "#11151c",
        "card-foreground": "#d7d4cc",
        popover: "#11151c",
        "popover-foreground": "#d7d4cc",
        primary: "#e6b450",
        "primary-foreground": "#0b0e14",
        secondary: "#191f29",
        "secondary-foreground": "#d7d4cc",
        muted: "#191f29",
        "muted-foreground": "#8f938e",
        accent: "#222a35",
        "accent-foreground": "#f0d18a",
        destructive: "#f07178",
        border: "#262d38",
        input: "#262d38",
        ring: "#e6b450",
        "chart-1": "#e6b450",
        "chart-2": "#59c2ff",
        "chart-3": "#aad94c",
        "chart-4": "#d2a6ff",
        "chart-5": "#f07178",
      },
    },
    {
      id: "tokyo-night",
      label: "Tokyo Night",
      description: "Cool blue-black palette with saturated accents.",
      swatches: ["#1a1b26", "#c0caf5", "#7aa2f7", "#24283b"],
      tokens: {
        background: "#1a1b26",
        foreground: "#c0caf5",
        card: "#1f2335",
        "card-foreground": "#c0caf5",
        popover: "#1f2335",
        "popover-foreground": "#c0caf5",
        primary: "#7aa2f7",
        "primary-foreground": "#11131d",
        secondary: "#24283b",
        "secondary-foreground": "#c0caf5",
        muted: "#24283b",
        "muted-foreground": "#8b93b9",
        accent: "#2f3549",
        "accent-foreground": "#c0caf5",
        destructive: "#f7768e",
        border: "#3b4261",
        input: "#3b4261",
        ring: "#7aa2f7",
        "chart-1": "#7aa2f7",
        "chart-2": "#2ac3de",
        "chart-3": "#e0af68",
        "chart-4": "#bb9af7",
        "chart-5": "#f7768e",
      },
    },
    {
      id: "terminal-green",
      label: "Terminal",
      description: "High-contrast terminal theme with neon focus.",
      swatches: ["#050806", "#e7f7e9", "#38ff7d", "#101612"],
      tokens: {
        background: "#050806",
        foreground: "#e7f7e9",
        card: "#0b110d",
        "card-foreground": "#e7f7e9",
        popover: "#0b110d",
        "popover-foreground": "#e7f7e9",
        primary: "#38ff7d",
        "primary-foreground": "#031006",
        secondary: "#101612",
        "secondary-foreground": "#e7f7e9",
        muted: "#101612",
        "muted-foreground": "#92a698",
        accent: "#16251b",
        "accent-foreground": "#bdfccc",
        destructive: "#ff5a67",
        border: "#243329",
        input: "#243329",
        ring: "#38ff7d",
        "chart-1": "#38ff7d",
        "chart-2": "#4deaff",
        "chart-3": "#ffd866",
        "chart-4": "#a987ff",
        "chart-5": "#ff5a67",
      },
    },
    {
      id: "notion-dark",
      label: "Notion",
      description: "Dim document workspace with gentle blue affordances.",
      swatches: ["#191919", "#f1f1ef", "#529cca", "#252525"],
      tokens: {
        background: "#191919",
        foreground: "#f1f1ef",
        card: "#202020",
        "card-foreground": "#f1f1ef",
        popover: "#202020",
        "popover-foreground": "#f1f1ef",
        primary: "#529cca",
        "primary-foreground": "#07151f",
        secondary: "#252525",
        "secondary-foreground": "#f1f1ef",
        muted: "#252525",
        "muted-foreground": "#a3a29f",
        accent: "#2f3437",
        "accent-foreground": "#dceeff",
        destructive: "#ff7369",
        border: "#333333",
        input: "#333333",
        ring: "#529cca",
        "chart-1": "#529cca",
        "chart-2": "#4dab9a",
        "chart-3": "#d6a43c",
        "chart-4": "#b48af7",
        "chart-5": "#ff7369",
      },
    },
    {
      id: "raycast-dark",
      label: "Raycast",
      description: "Fast command surface with red-hot action states.",
      swatches: ["#141416", "#f5f5f5", "#ff6363", "#242428"],
      tokens: {
        background: "#141416",
        foreground: "#f5f5f5",
        card: "#1d1d20",
        "card-foreground": "#f5f5f5",
        popover: "#1d1d20",
        "popover-foreground": "#f5f5f5",
        primary: "#ff6363",
        "primary-foreground": "#220606",
        secondary: "#242428",
        "secondary-foreground": "#f5f5f5",
        muted: "#242428",
        "muted-foreground": "#a0a0aa",
        accent: "#302222",
        "accent-foreground": "#ffdada",
        destructive: "#ff4d4d",
        border: "#303036",
        input: "#303036",
        ring: "#ff6363",
        "chart-1": "#ff6363",
        "chart-2": "#5cc8ff",
        "chart-3": "#ffbd59",
        "chart-4": "#9b7cff",
        "chart-5": "#ff4d4d",
      },
    },
    {
      id: "cloudflare-dark",
      label: "Cloudflare",
      description: "Edge-network dark mode with ember-orange focus.",
      swatches: ["#11100f", "#f5efe7", "#f6821f", "#201811"],
      tokens: {
        background: "#11100f",
        foreground: "#f5efe7",
        card: "#18140f",
        "card-foreground": "#f5efe7",
        popover: "#18140f",
        "popover-foreground": "#f5efe7",
        primary: "#f6821f",
        "primary-foreground": "#1f0d00",
        secondary: "#201811",
        "secondary-foreground": "#f5efe7",
        muted: "#201811",
        "muted-foreground": "#b89d84",
        accent: "#302113",
        "accent-foreground": "#ffd4a6",
        destructive: "#ff6b5f",
        border: "#36271a",
        input: "#36271a",
        ring: "#f6821f",
        "chart-1": "#f6821f",
        "chart-2": "#faae40",
        "chart-3": "#6cb6ff",
        "chart-4": "#a78bfa",
        "chart-5": "#ff6b5f",
      },
    },
    {
      id: "linear-dark",
      label: "Linear",
      description: "Focused planning surface with violet-blue glow.",
      swatches: ["#08090f", "#f7f8ff", "#5e6ad2", "#11131c"],
      tokens: {
        background: "#08090f",
        foreground: "#f7f8ff",
        card: "#11131c",
        "card-foreground": "#f7f8ff",
        popover: "#11131c",
        "popover-foreground": "#f7f8ff",
        primary: "#7c86ff",
        "primary-foreground": "#08090f",
        secondary: "#171a27",
        "secondary-foreground": "#f7f8ff",
        muted: "#171a27",
        "muted-foreground": "#9ca3bf",
        accent: "#202442",
        "accent-foreground": "#dfe2ff",
        destructive: "#ff6b6b",
        border: "#282d45",
        input: "#282d45",
        ring: "#7c86ff",
        "chart-1": "#7c86ff",
        "chart-2": "#37d6c2",
        "chart-3": "#f4bb5e",
        "chart-4": "#b48cff",
        "chart-5": "#ff6b6b",
      },
    },
    {
      id: "vercel-dark",
      label: "Vercel",
      description: "Pure deployment-console black with white focus.",
      swatches: ["#000000", "#fafafa", "#ffffff", "#111111"],
      tokens: {
        background: "#000000",
        foreground: "#fafafa",
        card: "#0a0a0a",
        "card-foreground": "#fafafa",
        popover: "#0a0a0a",
        "popover-foreground": "#fafafa",
        primary: "#ffffff",
        "primary-foreground": "#000000",
        secondary: "#111111",
        "secondary-foreground": "#fafafa",
        muted: "#111111",
        "muted-foreground": "#a1a1a1",
        accent: "#1f1f1f",
        "accent-foreground": "#ffffff",
        destructive: "#ff5c5c",
        border: "#262626",
        input: "#262626",
        ring: "#ffffff",
        "chart-1": "#ffffff",
        "chart-2": "#3291ff",
        "chart-3": "#f5a623",
        "chart-4": "#7928ca",
        "chart-5": "#ff5c5c",
      },
    },
    {
      id: "cursor-dark",
      label: "Cursor",
      description: "Modern code editor dark with soft green signal.",
      swatches: ["#101113", "#e6e7ea", "#8bd5ca", "#1a1d20"],
      tokens: {
        background: "#101113",
        foreground: "#e6e7ea",
        card: "#17191c",
        "card-foreground": "#e6e7ea",
        popover: "#17191c",
        "popover-foreground": "#e6e7ea",
        primary: "#8bd5ca",
        "primary-foreground": "#071514",
        secondary: "#1a1d20",
        "secondary-foreground": "#e6e7ea",
        muted: "#1a1d20",
        "muted-foreground": "#9aa3a8",
        accent: "#1f302d",
        "accent-foreground": "#c9fff5",
        destructive: "#ff6f6f",
        border: "#2a2f34",
        input: "#2a2f34",
        ring: "#8bd5ca",
        "chart-1": "#8bd5ca",
        "chart-2": "#74a7ff",
        "chart-3": "#e8bd68",
        "chart-4": "#c19cff",
        "chart-5": "#ff6f6f",
      },
    },
  ],
};

const THEME_PRESET_MAP = THEME_SURFACES.reduce((map, surface) => {
  map[surface] = new Map(THEME_PRESETS[surface].map((preset) => [preset.id, preset]));
  return map;
}, {});

const MEMBER_ROUTE_PREFIX = "/squad-members";
const SQUAD_MEMBER_ID_PREFIX = "asq_";
const LEGACY_SQUAD_MEMBER_ID_PREFIXES = ["wk_"];
const SQUAD_WORKSPACE_DIR_NAME = ".autohandsquad";
const LEGACY_SQUAD_WORKSPACE_DIR_NAMES = [".qoderwake", ".autohand-squad"];
const PROJECT_LIMIT_UPPER_BOUND = 5;
const DEFAULT_MAX_PROJECTS_PER_MEMBER = PROJECT_LIMIT_UPPER_BOUND;
const DEFAULT_HANDOFF_RETRY_MODE = "checkpoint";
const HANDOFF_RETRY_BRIDGE_DEFAULT = "bridge-default";
const HANDOFF_RETRY_MODES = ["checkpoint", "manual", "disabled"];

function storageKeysFor(name) {
  return [STORAGE_KEYS[name]];
}

const RUN_MODES = [
  { id: "prompt", label: "Command", detail: "--prompt" },
  { id: "auto", label: "Auto", detail: "--auto-mode" },
  { id: "goal", label: "Goal", detail: "--goal" },
];

const SIDEBAR_SHORTCUT_LABEL = "Cmd/Ctrl+B";

const POLICY_OPTIONS = [
  { id: "restricted", label: "restricted" },
  { id: "ask", label: "normal prompts" },
  { id: "yes", label: "yes mode" },
];

const PERMISSION_LEVELS = [
  {
    id: "allow",
    label: "Allow",
    tone: "border-primary/35 bg-primary/15 text-primary",
    indicator: "bg-primary",
  },
  {
    id: "ask",
    label: "Ask",
    tone: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-200",
    indicator: "bg-amber-500 dark:bg-amber-300",
  },
  {
    id: "block",
    label: "Deny",
    tone: "border-red-300 bg-red-100 text-red-800 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200",
    indicator: "bg-red-500 dark:bg-red-300",
  },
];

const CLI_PERMISSION_GROUPS = [
  {
    id: "shell",
    title: "Shell",
    description: "Command execution surfaces the CLI can run in the selected workspace.",
    icon: TerminalSquare,
    items: [
      {
        id: "shell.read",
        name: "Read-only shell",
        target: "Bash command",
        defaultMode: "allow",
        autonomy: "Autonomous",
        description: "Inspect folders, files, logs, and process output without mutating the workspace.",
        examples: ["pwd", "ls", "rg", "cat", "sed -n"],
      },
      {
        id: "shell.dev",
        name: "Build and test commands",
        target: "Bash command",
        defaultMode: "allow",
        autonomy: "Autonomous",
        description: "Run project checks that create normal build artifacts and test output.",
        examples: ["bun test", "npm run build", "pytest", "cargo test"],
      },
      {
        id: "shell.package",
        name: "Dependency install",
        target: "Bash command",
        defaultMode: "ask",
        autonomy: "Approval",
        description: "Install or update dependencies that may touch lockfiles and external registries.",
        examples: ["bun install", "npm install", "pip install"],
      },
      {
        id: "shell.git_write",
        name: "Git write operations",
        target: "Bash command",
        defaultMode: "ask",
        autonomy: "Approval",
        description: "Create commits, rewrite branches, push code, or change remote state.",
        examples: ["git commit", "git push", "git rebase"],
      },
      {
        id: "shell.destructive",
        name: "Destructive shell",
        target: "Bash command",
        defaultMode: "block",
        autonomy: "Blocked",
        description: "Commands that can destroy data, escalate privileges, or change host-level services.",
        examples: ["rm -rf", "chmod 777", "sudo", "mkfs"],
      },
    ],
  },
  {
    id: "workspace",
    title: "Workspace Tools",
    description: "Built-in file and code-editing capabilities exposed by the CLI runtime.",
    icon: FileCode2,
    items: [
      {
        id: "file.read",
        name: "Read files and folders",
        target: "file.read / dir.list",
        defaultMode: "allow",
        autonomy: "Autonomous",
        description: "Open source files, docs, configs, and directory listings inside the workspace.",
        examples: ["read file", "list directory", "view image"],
      },
      {
        id: "search.text",
        name: "Search code",
        target: "search.text",
        defaultMode: "allow",
        autonomy: "Autonomous",
        description: "Use fast text search to find routes, symbols, copy, and configuration references.",
        examples: ["rg", "find symbol", "trace route"],
      },
      {
        id: "patch.apply",
        name: "Apply patches",
        target: "apply_patch",
        defaultMode: "allow",
        autonomy: "Autonomous",
        description: "Edit workspace files through scoped patches while preserving unrelated user changes.",
        examples: ["update component", "add test", "fix copy"],
      },
      {
        id: "workspace.outside",
        name: "Outside workspace access",
        target: "filesystem",
        defaultMode: "ask",
        autonomy: "Approval",
        description: "Read or touch files beyond the selected repository or configured agent home.",
        examples: ["Desktop", "Downloads", "/tmp"],
      },
    ],
  },
  {
    id: "connected",
    title: "Connected Tools",
    description: "Networked and app tools that extend the agent beyond the local checkout.",
    icon: Globe2,
    items: [
      {
        id: "browser.local",
        name: "Local browser verification",
        target: "Browser",
        defaultMode: "allow",
        autonomy: "Autonomous",
        description: "Open localhost, click through flows, inspect screenshots, and verify UI changes.",
        examples: ["localhost", "screenshot", "responsive check"],
      },
      {
        id: "web.fetch",
        name: "Web lookup",
        target: "web_fetch",
        defaultMode: "ask",
        autonomy: "Approval",
        description: "Fetch external pages when current docs, prices, APIs, or public facts matter.",
        examples: ["docs", "release notes", "standards"],
      },
      {
        id: "github.remote",
        name: "GitHub operations",
        target: "GitHub",
        defaultMode: "ask",
        autonomy: "Approval",
        description: "Read PR context, inspect checks, push branches, or open draft pull requests.",
        examples: ["PR comments", "CI checks", "push"],
      },
      {
        id: "mcp.connectors",
        name: "MCP connectors",
        target: "MCP tools",
        defaultMode: "ask",
        autonomy: "Approval",
        description: "Use installed connectors that may access third-party accounts or private services.",
        examples: ["Figma", "Cloudflare", "Sheets"],
      },
    ],
  },
];

const SHELL_GUARDRAILS = [
  {
    id: "workspace-fence",
    label: "Workspace fence",
    state: "On",
    detail: "Commands stay scoped to the selected repository unless outside access is granted.",
  },
  {
    id: "destructive-approval",
    label: "Destructive commands",
    state: "Blocked",
    detail: "Disk wipes, privilege escalation, recursive deletion, and host service changes stay blocked.",
  },
  {
    id: "network-approval",
    label: "External network",
    state: "Ask",
    detail: "Registry installs, web lookups, tunnels, and remote publishing require approval.",
  },
  {
    id: "git-approval",
    label: "Git remote writes",
    state: "Ask",
    detail: "Commit creation, force operations, branch rewrites, and push actions stay gated.",
  },
];

const CLI_TOOL_PERMISSIONS = CLI_PERMISSION_GROUPS.flatMap((group) => group.items);
const DEFAULT_PERMISSION_MODES = Object.fromEntries(
  CLI_TOOL_PERMISSIONS.map((item) => [item.id, item.defaultMode])
);

const PERMISSION_TABS = [
  { id: "toolGuard", label: "Tool Guard" },
  { id: "fileGuard", label: "File Guard" },
  { id: "builtInTools", label: "Built-in Tools" },
  { id: "modelSecurity", label: "Model Security" },
];

const CLI_PERMISSION_MODE_OPTIONS = [
  { id: "interactive", label: "Interactive", detail: "Prompt on risky or unknown operations." },
  { id: "restricted", label: "Restricted", detail: "Deny dangerous operations." },
  { id: "unrestricted", label: "Unrestricted", detail: "Auto-approve non-blacklisted operations." },
  { id: "external", label: "External", detail: "Use the permission callback flow." },
];

const TOOL_GUARD_RULE_GROUPS = [
  {
    id: "command-injection",
    title: "Command Injection",
    rules: [
      ["TOOL_CMD_FS_DESTRUCTION", "critical", "Detects low-level disk formatting or wiping commands"],
      ["TOOL_CMD_DANGEROUS_RM", "high", "Shell command contains rm patterns that may cause data loss"],
      ["TOOL_CMD_DANGEROUS_MV", "high", "Shell command contains mv patterns that may overwrite files unexpectedly"],
    ],
  },
  {
    id: "resource-abuse",
    title: "Resource Abuse",
    rules: [
      ["TOOL_CMD_DOS_FORK_BOMB", "critical", "Detects Bash fork bombs and mass process termination"],
      ["TOOL_CMD_SYSTEM_REBOOT", "critical", "Detects reboot or shutdown commands that terminate the host"],
      ["TOOL_CMD_SERVICE_RESTART", "high", "Detects service management commands that can disrupt system services"],
      ["TOOL_CMD_INFINITE_OUTPUT", "medium", "Detects commands likely to stream unbounded output or saturate logs"],
    ],
  },
  {
    id: "network-abuse",
    title: "Network Abuse",
    rules: [
      ["TOOL_CMD_REVERSE_SHELL", "critical", "Detects reverse shells or unauthorized network tunnels"],
      ["TOOL_WEBFETCH_LOCAL_LOOPBACK", "high", "Detects loopback or cloud metadata fetches that may probe internal services"],
      ["TOOL_CMD_REMOTE_PIPE_EXEC", "high", "Detects curl or wget piped directly into a shell"],
    ],
  },
  {
    id: "sensitive-file-access",
    title: "Sensitive File Access",
    rules: [
      ["TOOL_CMD_SYSTEM_TAMPERING", "high", "Detects access to cron jobs, SSH keys, sudoers, or system credentials"],
      ["TOOL_CMD_PROC_ENVIRON", "high", "Detects /proc/*/environ reads that may expose environment secrets"],
      ["TOOL_WEBFETCH_FILE_SCHEME", "high", "Detects non-HTTP(S) URL schemes such as file://, gopher://, or ftp://"],
      ["TOOL_FILE_CREDENTIALS", "critical", "Detects .env, SSH, cloud, npm, Docker, Kubernetes, and private key paths"],
    ],
  },
  {
    id: "privilege-escalation",
    title: "Privilege Escalation",
    rules: [
      ["TOOL_CMD_PRIVILEGE_ESCALATION", "critical", "Detects sudo, su, doas, pkexec, or runas attempts"],
      ["TOOL_CMD_UNSAFE_PERMISSIONS", "high", "Detects chmod 777, immutable flag changes, or global permission downgrades"],
    ],
  },
];

const SHELL_EVASION_RULES = [
  ["command-substitution", "Command Substitution", "Detects unescaped backticks, $(), <(), =(), ${}, Zsh =cmd, or PowerShell substitutions."],
  ["obfuscated-flags", "Obfuscated Flags", "Detects ANSI-C strings, locale strings, empty-quote dashes, and quoted flags."],
  ["backslash-whitespace", "Backslash-Escaped Whitespace", "Detects escaped spaces or tabs that parsers may tokenize inconsistently."],
  ["backslash-operators", "Backslash-Escaped Operators", "Detects escaped ;, &, <, and > outside quotes."],
  ["newlines", "Newlines", "Detects hidden command separators and trailing newline tricks."],
  ["comment-quote-desync", "Comment Quote Desync", "Detects quotes inside comments that desynchronize naive quote trackers."],
  ["quoted-newline", "Quoted Newline", "Detects quoted newlines followed by commented command fragments."],
];

const DEFAULT_SENSITIVE_PATHS = [
  ".env",
  ".env.*",
  ".git/config",
  ".npmrc",
  "~/.ssh/*",
  "~/.aws/*",
  "~/.kube/config",
  "~/.docker/config.json",
  "*.pem",
  "*.key",
  ".autohand/secrets/*",
];

const FILE_GUARD_TARGET_TOOLS = [
  "read_file",
  "write_file",
  "append_file",
  "apply_patch",
  "search_replace",
  "notebook_edit",
  "delete_path",
];

const BUILT_IN_TOOL_POLICY_GROUPS = [
  {
    id: "goals-planning",
    title: "Goals & Planning",
    tools: [
      ["tools_registry", "allow"],
      ["tool_search", "allow"],
      ["ask_followup_question", "allow"],
      ["todo_write", "allow"],
      ["plan", "allow"],
      ["exit_plan_mode", "allow"],
      ["get_goal", "allow"],
      ["create_goal", "ask"],
      ["create_goal_from_template", "ask"],
      ["update_goal", "ask"],
      ["clear_goal", "ask"],
      ["list_goal_templates", "allow"],
      ["enqueue_goal", "ask"],
      ["list_goal_queue", "allow"],
      ["start_queued_goal", "ask"],
      ["dequeue_goal", "ask"],
      ["remove_queued_goal", "ask"],
    ],
  },
  {
    id: "profile-memory",
    title: "Memory, Skills & Teams",
    tools: [
      ["skill", "allow"],
      ["find_agent_skills", "allow"],
      ["install_agent_skill", "ask"],
      ["save_memory", "ask"],
      ["recall_memory", "allow"],
      ["smart_context_cropper", "allow"],
      ["create_meta_tool", "ask"],
      ["delegate_task", "ask"],
      ["delegate_parallel", "ask"],
      ["create_team", "ask"],
      ["add_teammate", "ask"],
      ["team_status", "allow"],
      ["send_team_message", "ask"],
    ],
  },
  {
    id: "shell",
    title: "Shell",
    tools: [
      ["shell", "ask"],
      ["run_command", "ask"],
      ["custom_command", "ask"],
    ],
  },
  {
    id: "filesystem-read",
    title: "Filesystem Read & Inspect",
    tools: [
      ["read_file", "allow"],
      ["fff_find", "allow"],
      ["fff_grep", "allow"],
      ["list_tree", "allow"],
      ["file_stats", "allow"],
      ["checksum", "ask"],
    ],
  },
  {
    id: "filesystem-write",
    title: "Filesystem Write & Mutate",
    tools: [
      ["write_file", "ask"],
      ["append_file", "ask"],
      ["apply_patch", "ask"],
      ["search_replace", "ask"],
      ["notebook_edit", "ask"],
      ["format_file", "ask"],
      ["create_directory", "ask"],
      ["rename_path", "ask"],
      ["copy_path", "ask"],
      ["delete_path", "block"],
      ["add_dependency", "ask"],
      ["remove_dependency", "ask"],
    ],
  },
  {
    id: "git-read",
    title: "Git Read",
    tools: [
      ["git_status", "allow"],
      ["git_list_untracked", "allow"],
      ["git_diff", "allow"],
      ["git_diff_range", "allow"],
      ["git_log", "allow"],
      ["git_branch", "allow"],
      ["git_worktree_list", "allow"],
      ["git_worktree_status_all", "allow"],
      ["git_stash_list", "allow"],
    ],
  },
  {
    id: "git-write",
    title: "Git Write",
    tools: [
      ["git_add", "ask"],
      ["git_commit", "ask"],
      ["auto_commit", "ask"],
      ["git_push", "ask"],
      ["git_fetch", "ask"],
      ["git_pull", "ask"],
      ["git_checkout", "ask"],
      ["git_switch", "ask"],
      ["git_merge", "ask"],
      ["git_merge_abort", "ask"],
      ["git_apply_patch", "ask"],
      ["git_stash", "ask"],
      ["git_stash_pop", "ask"],
      ["git_stash_apply", "ask"],
      ["git_stash_drop", "ask"],
      ["git_cherry_pick", "ask"],
      ["git_cherry_pick_abort", "ask"],
      ["git_cherry_pick_continue", "ask"],
      ["git_rebase", "ask"],
      ["git_rebase_abort", "ask"],
      ["git_rebase_continue", "ask"],
      ["git_rebase_skip", "ask"],
      ["git_reset", "block"],
      ["git_worktree_add", "ask"],
      ["git_worktree_remove", "ask"],
      ["git_worktree_cleanup", "ask"],
      ["git_worktree_run_parallel", "ask"],
      ["git_worktree_sync", "ask"],
      ["git_worktree_create_for_pr", "ask"],
      ["git_worktree_create_from_template", "ask"],
    ],
  },
  {
    id: "web-browser",
    title: "Web & Browser",
    tools: [
      ["web_search", "ask"],
      ["fetch_url", "ask"],
      ["web_repo", "ask"],
      ["package_info", "allow"],
      ["browser_screenshot", "allow"],
      ["browser_navigate", "allow"],
      ["browser_get_page_context", "allow"],
      ["browser_get_element", "allow"],
      ["browser_find_element", "allow"],
      ["browser_wait_for_element", "allow"],
      ["browser_get_tabs", "allow"],
      ["browser_get_tab_groups", "allow"],
      ["browser_read_network", "allow"],
      ["browser_read_console", "allow"],
      ["browser_click", "ask"],
      ["browser_type", "ask"],
      ["browser_scroll", "ask"],
      ["browser_press_key", "ask"],
      ["browser_execute_js", "ask"],
    ],
  },
  {
    id: "tasks-automation",
    title: "Tasks & Automation",
    tools: [
      ["create_task", "ask"],
      ["task_get", "allow"],
      ["task_list", "allow"],
      ["task_update", "ask"],
      ["task_stop", "ask"],
      ["task_output", "allow"],
      ["sleep", "allow"],
      ["cron_create", "ask"],
      ["cron_delete", "ask"],
      ["list_schedules", "allow"],
      ["cancel_schedule", "ask"],
    ],
  },
  {
    id: "workspace-meta",
    title: "Workspace & Review",
    tools: [
      ["enter_worktree", "ask"],
      ["exit_worktree", "allow"],
      ["project_tracker", "allow"],
      ["request_directory_access", "ask"],
      ["code_review", "allow"],
    ],
  },
];

const DEFAULT_BUILT_IN_TOOL_POLICIES = Object.fromEntries(
  BUILT_IN_TOOL_POLICY_GROUPS.flatMap((group) => group.tools.map(([name, mode]) => [name, mode]))
);

const MODEL_PROVIDER_OPTIONS = [
  "openrouter",
  "openai",
  "llmgateway",
  "ollama",
  "bedrock",
  "deepseek",
  "zai",
  "nvidia",
  "cerebras",
];

const AUTOMATION_MODELS = ["auto", "gpt-5", "gpt-5-mini", "claude-sonnet", "local"];
const AUTOMATION_TRIGGER_TYPES = [
  { id: "schedule", label: "Schedule", description: "Run the project task on a schedule", icon: CalendarClock },
  { id: "event", label: "Event", description: "Trigger from Git repository events", icon: GitBranch },
  { id: "webhook", label: "Webhook", description: "Trigger from webhook or API calls", icon: Webhook },
];
const AUTOMATION_EVENT_SOURCES = ["GitHub", "GitLab", "Bitbucket"];
const AUTOMATION_EVENT_TYPES = ["pull_request.opened", "pull_request.updated", "push", "issue_comment.created"];
const AUTOMATION_SCHEDULE_FREQUENCIES = [
  { id: "daily", label: "Daily" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Weekly" },
  { id: "manual", label: "Manual only" },
];

const MEMBER_SECTIONS = [
  { id: "home", label: "Home", icon: CircleUserRound },
  { id: "project", label: "Projects", icon: Folders },
  { id: "triggers", label: "Automations", icon: Clock3 },
  { id: "task", label: "Tasks", icon: CalendarCheck2 },
  { id: "memory", label: "Memory", icon: BrainCog },
  { id: "skill", label: "Skill", icon: Sparkles },
  { id: "connector", label: "Connector", icon: Unplug },
  { id: "im", label: "IM", icon: MessageSquareText },
  { id: "permissions", label: "Permission", icon: ShieldAlert },
];

const CUSTOM_ROLE_TEMPLATE = {
  id: "custom-role",
    title: "Custom Role",
    description: "",
    starter:
    "Act according to this squad member's bio. Keep work scoped, ask when the role is ambiguous, and report evidence clearly.",
  skills: [],
};

const CUSTOM_ROLE_SECTIONS = [
  {
    id: "identity",
    title: "Core Responsibilities",
    badge: "Identity",
    fileName: "IDENTITY.md",
    uploadLabel: "Upload identity.md",
    placeholder:
      "Describe what this role is responsible for, the kinds of problems it owns, and the evidence it should produce.",
  },
  {
    id: "persona",
    title: "Work Style",
    badge: "Persona",
    fileName: "PERSONA.md",
    aliases: ["PERSONALITY.md"],
    uploadLabel: "Upload persona.md",
    placeholder:
      "Describe tone, collaboration style, defaults, escalation rules, and how this squad member should interact with people.",
  },
  {
    id: "bible",
    title: "Workflow",
    badge: "Bible",
    fileName: "BIBLE.md",
    uploadLabel: "Upload bible.md",
    placeholder:
      "Describe the standard workflow, verification expectations, tools, boundaries, and recurring operating rules.",
  },
  {
    id: "memory",
    title: "Memory",
    badge: "Memory",
    fileName: "MEMORY.md",
    uploadLabel: "Upload memory.md",
    placeholder:
      "Describe durable context, project preferences, and learned details this squad member should keep available.",
  },
];

const createEmptyCustomRoleDraft = () => ({
  title: "",
  description: "",
  avatar: "",
  mode: "upload",
  sections: CUSTOM_ROLE_SECTIONS.reduce((acc, section) => ({ ...acc, [section.id]: "" }), {}),
  sectionFileNames: CUSTOM_ROLE_SECTIONS.reduce((acc, section) => ({ ...acc, [section.id]: "" }), {}),
  skillsText: "",
  mcpText: "",
});

function createDefaultPermissionState() {
  return {
    permissionMode: "interactive",
    rememberSession: true,
    profile: "guarded-autonomy",
    toolGuardEnabled: true,
    fileGuardEnabled: true,
    builtInToolPolicyEnabled: true,
    modelSecurityEnabled: false,
    shellReviewEnabled: true,
    shellEvasionEnabled: true,
    modes: { ...DEFAULT_PERMISSION_MODES },
    builtInPolicies: { ...DEFAULT_BUILT_IN_TOOL_POLICIES },
    toolGuardRules: Object.fromEntries(TOOL_GUARD_RULE_GROUPS.flatMap((group) => group.rules.map(([id]) => [id, true]))),
    shellEvasionRules: Object.fromEntries(SHELL_EVASION_RULES.map(([id]) => [id, true])),
    sensitivePaths: [...DEFAULT_SENSITIVE_PATHS],
    allPathsAllowed: false,
    allUrlsAllowed: false,
    modelSecurity: {
      provider: "openrouter",
      model: "openrouter/auto",
      thinkingLevel: "normal",
      toolChoice: "auto",
      requireNativeToolCalling: true,
      lockModelSelector: false,
      requireConfiguredSearchProvider: true,
    },
  };
}

function normalizePermissionState(permissions) {
  const defaults = createDefaultPermissionState();
  const modes = permissions?.modes && typeof permissions.modes === "object" ? permissions.modes : {};
  const builtInPolicies = permissions?.builtInPolicies && typeof permissions.builtInPolicies === "object"
    ? permissions.builtInPolicies
    : {};
  const toolGuardRules = permissions?.toolGuardRules && typeof permissions.toolGuardRules === "object"
    ? permissions.toolGuardRules
    : {};
  const shellEvasionRules = permissions?.shellEvasionRules && typeof permissions.shellEvasionRules === "object"
    ? permissions.shellEvasionRules
    : {};
  const normalizedModes = { ...defaults.modes };
  for (const item of CLI_TOOL_PERMISSIONS) {
    const value = modes[item.id];
    normalizedModes[item.id] = PERMISSION_LEVELS.some((level) => level.id === value) ? value : item.defaultMode;
  }
  const normalizedBuiltInPolicies = { ...defaults.builtInPolicies };
  for (const tool of Object.keys(DEFAULT_BUILT_IN_TOOL_POLICIES)) {
    const value = builtInPolicies[tool];
    normalizedBuiltInPolicies[tool] = PERMISSION_LEVELS.some((level) => level.id === value)
      ? value
      : defaults.builtInPolicies[tool];
  }
  const normalizedToolGuardRules = { ...defaults.toolGuardRules };
  for (const id of Object.keys(defaults.toolGuardRules)) {
    normalizedToolGuardRules[id] = typeof toolGuardRules[id] === "boolean" ? toolGuardRules[id] : defaults.toolGuardRules[id];
  }
  const normalizedShellEvasionRules = { ...defaults.shellEvasionRules };
  for (const id of Object.keys(defaults.shellEvasionRules)) {
    normalizedShellEvasionRules[id] = typeof shellEvasionRules[id] === "boolean" ? shellEvasionRules[id] : defaults.shellEvasionRules[id];
  }

  return {
    ...defaults,
    ...(permissions && typeof permissions === "object" ? permissions : {}),
    modes: normalizedModes,
    builtInPolicies: normalizedBuiltInPolicies,
    toolGuardRules: normalizedToolGuardRules,
    shellEvasionRules: normalizedShellEvasionRules,
    sensitivePaths: Array.isArray(permissions?.sensitivePaths)
      ? Array.from(new Set(permissions.sensitivePaths.map((item) => String(item || "").trim()).filter(Boolean)))
      : defaults.sensitivePaths,
    modelSecurity: {
      ...defaults.modelSecurity,
      ...(permissions?.modelSecurity && typeof permissions.modelSecurity === "object" ? permissions.modelSecurity : {}),
    },
    permissionMode: CLI_PERMISSION_MODE_OPTIONS.some((mode) => mode.id === permissions?.permissionMode)
      ? permissions.permissionMode
      : defaults.permissionMode,
    rememberSession: permissions?.rememberSession ?? defaults.rememberSession,
    toolGuardEnabled: permissions?.toolGuardEnabled ?? defaults.toolGuardEnabled,
    fileGuardEnabled: permissions?.fileGuardEnabled ?? defaults.fileGuardEnabled,
    builtInToolPolicyEnabled: permissions?.builtInToolPolicyEnabled ?? defaults.builtInToolPolicyEnabled,
    modelSecurityEnabled: permissions?.modelSecurityEnabled ?? defaults.modelSecurityEnabled,
    shellReviewEnabled: permissions?.shellReviewEnabled ?? defaults.shellReviewEnabled,
    shellEvasionEnabled: permissions?.shellEvasionEnabled ?? defaults.shellEvasionEnabled,
    allPathsAllowed: permissions?.allPathsAllowed ?? defaults.allPathsAllowed,
    allUrlsAllowed: permissions?.allUrlsAllowed ?? defaults.allUrlsAllowed,
  };
}

function permissionLevelMeta(mode) {
  return PERMISSION_LEVELS.find((level) => level.id === mode) || PERMISSION_LEVELS[1];
}

const roleVisuals = {
  "frontend-developer": {
    icon: Code2,
    className: "bg-emerald-100 text-emerald-950 dark:bg-emerald-300/20 dark:text-emerald-100",
  },
  "backend-engineer": {
    icon: Boxes,
    className: "bg-lime-100 text-lime-950 dark:bg-lime-300/20 dark:text-lime-100",
  },
  "full-stack-developer": {
    icon: Code2,
    className: "bg-blue-100 text-blue-950 dark:bg-blue-300/20 dark:text-blue-100",
  },
  "mobile-developer": {
    icon: PanelRightOpen,
    className: "bg-cyan-100 text-cyan-950 dark:bg-cyan-300/20 dark:text-cyan-100",
  },
  "ux-ui-designer": {
    icon: Sparkles,
    className: "bg-rose-100 text-rose-950 dark:bg-rose-300/20 dark:text-rose-100",
  },
  "solution-architect": {
    icon: Boxes,
    className: "bg-indigo-100 text-indigo-950 dark:bg-indigo-300/20 dark:text-indigo-100",
  },
  "devops-engineer": {
    icon: TerminalSquare,
    className: "bg-orange-100 text-orange-950 dark:bg-orange-300/20 dark:text-orange-100",
  },
  "platform-engineer": {
    icon: Workflow,
    className: "bg-teal-100 text-teal-950 dark:bg-teal-300/20 dark:text-teal-100",
  },
  "security-engineer": {
    icon: ShieldCheck,
    className: "bg-red-100 text-red-950 dark:bg-red-300/20 dark:text-red-100",
  },
  "ai-engineer": {
    icon: Brain,
    className: "bg-purple-100 text-purple-950 dark:bg-purple-300/20 dark:text-purple-100",
  },
  "scrum-master": {
    icon: CalendarClock,
    className: "bg-sky-100 text-sky-950 dark:bg-sky-300/20 dark:text-sky-100",
  },
  "technical-writer": {
    icon: MessageSquareText,
    className: "bg-zinc-100 text-zinc-950 dark:bg-zinc-300/20 dark:text-zinc-100",
  },
  "common-qa-engineer": {
    icon: ClipboardCheck,
    className: "bg-violet-100 text-violet-950 dark:bg-violet-300/20 dark:text-violet-100",
  },
  "product-manager": {
    icon: LayoutList,
    className: "bg-pink-100 text-pink-950 dark:bg-pink-300/20 dark:text-pink-100",
  },
  "data-analyst": {
    icon: Database,
    className: "bg-amber-100 text-amber-950 dark:bg-amber-300/20 dark:text-amber-100",
  },
  "content-operations-specialist": {
    icon: MessageSquareText,
    className: "bg-stone-100 text-stone-950 dark:bg-stone-300/20 dark:text-stone-100",
  },
  "custom-role": {
    icon: UserRound,
    className: "bg-muted text-foreground",
  },
};

function readLocalStorage(keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  try {
    for (const key of keyList) {
      const value = window.localStorage.getItem(key);
      if (value) return value;
    }
  } catch {
    return "";
  }
  return "";
}

function readStored(keys, fallback) {
  try {
    const raw = readLocalStorage(keys);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function readLocalePreference() {
  const stored = readStored(storageKeysFor("locale"), null);
  if (typeof stored === "string") {
    return { mode: LOCALE_MODE_MANUAL, locale: resolveSupportedLocale(stored) || DEFAULT_LOCALE };
  }

  if (stored?.mode === LOCALE_MODE_MANUAL) {
    return { mode: LOCALE_MODE_MANUAL, locale: resolveSupportedLocale(stored.locale) || DEFAULT_LOCALE };
  }

  return { mode: LOCALE_MODE_AUTO, locale: resolveSupportedLocale(stored?.locale) || DEFAULT_LOCALE };
}

function normalizeThemeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "auto") return THEME_MODE_SYSTEM;
  return THEME_MODES.includes(mode) ? mode : DEFAULT_THEME_PREFERENCE.mode;
}

function normalizeThemeSurface(value) {
  return value === THEME_MODE_LIGHT ? THEME_MODE_LIGHT : THEME_MODE_DARK;
}

function normalizeThemePresetId(surface, value) {
  const normalizedSurface = normalizeThemeSurface(surface);
  const id = String(value || "").trim();
  return THEME_PRESET_MAP[normalizedSurface].has(id) ? id : DEFAULT_THEME_PREFERENCE[`${normalizedSurface}Theme`];
}

function normalizeThemePreference(value) {
  if (typeof value === "string") {
    return {
      ...DEFAULT_THEME_PREFERENCE,
      mode: normalizeThemeMode(value),
    };
  }

  const source = value && typeof value === "object" ? value : {};
  return {
    mode: normalizeThemeMode(source.mode),
    lightTheme: normalizeThemePresetId(THEME_MODE_LIGHT, source.lightTheme || source.light),
    darkTheme: normalizeThemePresetId(THEME_MODE_DARK, source.darkTheme || source.dark),
  };
}

function readThemePreference() {
  const raw = readLocalStorage(storageKeysFor("theme"));
  if (!raw) return DEFAULT_THEME_PREFERENCE;

  try {
    return normalizeThemePreference(JSON.parse(raw));
  } catch {
    return normalizeThemePreference(raw);
  }
}

function normalizeHandoffRetryMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (["manual", "manual-retry", "user", "user-driven"].includes(mode)) return "manual";
  if (["disabled", "disable", "off", "none", "never"].includes(mode)) return "disabled";
  return DEFAULT_HANDOFF_RETRY_MODE;
}

function readHandoffSettings() {
  const stored = readStored(storageKeysFor("handoffSettings"), null);
  if (!stored || typeof stored !== "object") return { retryMode: "" };
  const rawRetryMode = String(stored.retryMode || "").trim();
  return {
    retryMode: rawRetryMode ? normalizeHandoffRetryMode(rawRetryMode) : "",
  };
}

function resolveHandoffRetryMode(settings, runtime) {
  const storedMode = String(settings?.retryMode || "").trim();
  if (storedMode) return normalizeHandoffRetryMode(storedMode);
  return normalizeHandoffRetryMode(runtime?.handoffs?.retryMode || DEFAULT_HANDOFF_RETRY_MODE);
}

function handoffRetryModeLabel(id, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  return copy.handoffRetryLabels?.[id] || id;
}

function handoffRetryModeDescription(id, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  return copy.handoffRetryDescriptions?.[id] || "";
}

function getSystemColorMode() {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? THEME_MODE_LIGHT : THEME_MODE_DARK;
  } catch {
    return THEME_MODE_DARK;
  }
}

function resolveEffectiveThemeMode(preference, systemTheme) {
  const normalized = normalizeThemePreference(preference);
  return normalized.mode === THEME_MODE_SYSTEM ? normalizeThemeSurface(systemTheme) : normalizeThemeSurface(normalized.mode);
}

function getThemePreset(preference, surface) {
  const normalizedPreference = normalizeThemePreference(preference);
  const normalizedSurface = normalizeThemeSurface(surface);
  const presetId = normalizedPreference[`${normalizedSurface}Theme`];
  return THEME_PRESET_MAP[normalizedSurface].get(presetId) || THEME_PRESETS[normalizedSurface][0];
}

function normalizeSquadMemberId(id) {
  const value = String(id || "").trim();
  const legacyPrefix = LEGACY_SQUAD_MEMBER_ID_PREFIXES.find((prefix) => value.startsWith(prefix));
  return legacyPrefix ? `${SQUAD_MEMBER_ID_PREFIX}${value.slice(legacyPrefix.length)}` : value;
}

function createSquadMemberId() {
  return `${SQUAD_MEMBER_ID_PREFIX}${Date.now().toString(36)}`;
}

function createAutomationId() {
  return `tr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAutomationCopy(automation, defaultAgentId = initialAgents[0]?.id) {
  const createdAt = automation?.createdAt || new Date().toISOString();
  const triggerType = ["schedule", "event", "webhook"].includes(automation?.triggerType)
    ? automation.triggerType
    : "schedule";
  return {
    id: automation?.id || createAutomationId(),
    agentId: normalizeSquadMemberId(automation?.agentId || defaultAgentId),
    name: String(automation?.name || "Untitled automation"),
    prompt: String(automation?.prompt || automation?.description || "Run the configured Autohand task."),
    description: String(automation?.description || automation?.prompt || ""),
    workspaceSource: automation?.workspaceSource === "project" ? "project" : "local",
    workspace: normalizePath(automation?.workspace || automation?.localDirectory || ""),
    target: String(automation?.target || automation?.workspace || "local"),
    model: String(automation?.model || "auto"),
    triggerType,
    schedule: String(automation?.schedule || ""),
    scheduleFrequency: String(automation?.scheduleFrequency || "daily"),
    scheduleTime: String(automation?.scheduleTime || "09:00"),
    eventSource: String(automation?.eventSource || "GitHub"),
    eventType: String(automation?.eventType || "pull_request.opened"),
    linkedRepository: String(automation?.linkedRepository || ""),
    webhookPath: String(automation?.webhookPath || `/api/automations/${automation?.id || "new"}/run`),
    status: automation?.status === "paused" ? "paused" : "active",
    runCount: Number.isFinite(Number(automation?.runCount)) ? Number(automation.runCount) : 0,
    createdAt,
    updatedAt: automation?.updatedAt || createdAt,
    lastRun: automation?.lastRun || null,
    runHistory: Array.isArray(automation?.runHistory) ? automation.runHistory : [],
  };
}

function automationBelongsToAgent(automation, agentId) {
  return normalizeSquadMemberId(automation?.agentId) === normalizeSquadMemberId(agentId);
}

function automationDraftFrom(automation, agent, defaultWorkspace) {
  const id = automation?.id || "";
  return {
    id,
    name: automation?.name || "",
    workspaceSource: automation?.workspaceSource || "local",
    workspace: automation?.workspace || defaultWorkspace || agent?.workspace || "",
    description: automation?.description || automation?.prompt || "",
    model: automation?.model || "auto",
    triggerType: automation?.triggerType || "schedule",
    scheduleFrequency: automation?.scheduleFrequency || "daily",
    scheduleTime: automation?.scheduleTime || "09:00",
    eventSource: automation?.eventSource || "GitHub",
    eventType: automation?.eventType || "pull_request.opened",
    linkedRepository: automation?.linkedRepository || "",
    webhookPath: automation?.webhookPath || `/api/squad-members/${agent?.id || "member"}/automations/${id || "new"}/run`,
  };
}

function buildAutomationFromDraft(draft, existing, agent, defaultWorkspace) {
  const id = existing?.id || createAutomationId();
  const timestamp = new Date().toISOString();
  const workspace = normalizePath(draft.workspace || defaultWorkspace || agent?.workspace || "");
  const base = normalizeAutomationCopy(
    {
      ...existing,
      id,
      agentId: agent?.id,
      name: draft.name.trim(),
      prompt: draft.description.trim(),
      description: draft.description.trim(),
      workspaceSource: draft.workspaceSource,
      workspace,
      target: workspace || draft.workspaceSource,
      model: draft.model,
      triggerType: draft.triggerType,
      scheduleFrequency: draft.scheduleFrequency,
      scheduleTime: draft.scheduleTime,
      eventSource: draft.eventSource,
      eventType: draft.eventType,
      linkedRepository: draft.linkedRepository.trim(),
      webhookPath: draft.webhookPath || `/api/squad-members/${agent?.id || "member"}/automations/${id}/run`,
      status: existing?.status || "active",
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    },
    agent?.id
  );
  return {
    ...base,
    schedule: automationScheduleLabel(base),
  };
}

function clampProjectLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_PROJECTS_PER_MEMBER;
  return Math.min(PROJECT_LIMIT_UPPER_BOUND, Math.max(1, Math.floor(parsed)));
}

function configuredProjectLimit(runtime) {
  return clampProjectLimit(runtime?.limits?.maxProjectsPerMember);
}

function projectIdForPath(path) {
  const value = normalizePath(path);
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `project_${hash.toString(36)}`;
}

function projectRecordFromPath(input, workspaces = [], addedAt = "") {
  const source = typeof input === "string" ? { path: input } : input && typeof input === "object" ? input : {};
  const path = normalizePath(source.path);
  if (!path) return null;

  const workspace = workspaces.find((item) => normalizePath(item.path) === path);
  const name = String(source.name || workspace?.name || workspaceName(path) || path);
  const label = String(source.label || workspace?.label || name);
  return {
    id: String(source.id || projectIdForPath(path)),
    name,
    label,
    path,
    kind: String(source.kind || workspace?.kind || "project"),
    addedAt: String(source.addedAt || addedAt || ""),
  };
}

function normalizeAgentProjects(projects, fallbackWorkspace = "", workspaces = [], limit = DEFAULT_MAX_PROJECTS_PER_MEMBER) {
  const projectLimit = clampProjectLimit(limit);
  const sourceProjects = Array.isArray(projects) && projects.length ? projects : fallbackWorkspace ? [fallbackWorkspace] : [];
  const seen = new Set();
  const records = [];

  for (const item of sourceProjects) {
    const record = projectRecordFromPath(item, workspaces);
    if (!record || seen.has(record.path)) continue;
    seen.add(record.path);
    records.push(record);
    if (records.length >= projectLimit) break;
  }

  return records;
}

function projectRecordsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeAgentCopy(agent) {
  if (!agent || typeof agent !== "object") return agent;
  const projects = normalizeAgentProjects(agent.projects, agent.workspace);
  return {
    ...agent,
    id: normalizeSquadMemberId(agent.id),
    description: String(agent.description || ""),
    instructions: String(agent.instructions || ""),
    skills: normalizeSkillList(agent.skills),
    skillSource: agent.skillSource || AUTOHAND_SKILLS_REGISTRY_URL,
    stats: agent.stats
      ? {
          ...agent.stats,
          activeDays: agent.stats.activeDays ?? 0,
          automations: agent.stats.automations ?? 0,
          tasks: agent.stats.tasks ?? 0,
          projects: projects.length,
        }
      : { activeDays: 0, automations: 0, tasks: 0, projects: projects.length },
    permissions: normalizePermissionState(agent.permissions),
    projects,
    memory: Array.isArray(agent.memory) ? agent.memory.map((item) => String(item || "")) : agent.memory,
  };
}

function normalizeMessageCopy(messagesByAgent) {
  if (!messagesByAgent || typeof messagesByAgent !== "object") return messagesByAgent;
  const normalized = {};
  for (const [agentId, messages] of Object.entries(messagesByAgent)) {
    const normalizedId = normalizeSquadMemberId(agentId);
    const normalizedMessages = Array.isArray(messages)
      ? messages.map((message) => ({
          ...message,
          body: String(message.body || ""),
        }))
      : [];
    normalized[normalizedId] = [...(normalized[normalizedId] || []), ...normalizedMessages];
  }
  return normalized;
}

function normalizeTaskCopy(task) {
  if (!task || typeof task !== "object") return null;
  const ownerId = normalizeSquadMemberId(task.currentOwnerId || task.agentId);
  const originAgentId = normalizeSquadMemberId(task.originAgentId || task.sourceAgentId || task.agentId || ownerId);
  const createdAt = String(task.createdAt || task.updatedAt || new Date().toISOString());
  const baseAssignment = {
    id: `${task.id || "task"}-assignment-root`,
    agentId: originAgentId,
    sourceAgentId: originAgentId,
    status: task.status === "completed" ? "completed" : "active",
    reason: "Initial owner",
    requiredContext: task.summary || task.title || "",
    expectedOutput: task.summary || "Complete the assigned work.",
    sourceEvidence: task.runtimeId ? `Runtime ${task.runtimeId}` : "",
    createdAt,
    updatedAt: String(task.updatedAt || createdAt),
    attempt: 1,
  };
  const assignments = Array.isArray(task.assignments) && task.assignments.length ? task.assignments : [baseAssignment];
  const timeline = Array.isArray(task.timeline) && task.timeline.length
    ? task.timeline
    : [
        {
          id: `${task.id || "task"}-created`,
          type: "task.created",
          at: createdAt,
          actorAgentId: originAgentId,
          targetAgentId: ownerId,
          summary: task.summary || task.title || "Task created.",
        },
      ];

  return {
    ...task,
    agentId: ownerId,
    currentOwnerId: ownerId,
    originAgentId,
    assignments,
    handoffs: Array.isArray(task.handoffs) ? task.handoffs : [],
    timeline,
  };
}

function normalizeTasksCopy(tasks) {
  return (Array.isArray(tasks) ? tasks : initialTasks).map(normalizeTaskCopy).filter(Boolean);
}

function mergeSeedAgents(storedAgents) {
  const records = Array.isArray(storedAgents) ? storedAgents : [];
  const seen = new Set(records.map((agent) => normalizeSquadMemberId(agent?.id)).filter(Boolean));
  return [
    ...records,
    ...initialAgents.filter((agent) => !seen.has(normalizeSquadMemberId(agent.id))),
  ];
}

function mergeSeedTasks(storedTasks) {
  const records = Array.isArray(storedTasks) ? storedTasks : [];
  const seen = new Set(records.map((task) => String(task?.id || "")).filter(Boolean));
  return [
    ...initialTasks.filter((task) => !seen.has(String(task.id || ""))),
    ...records,
  ];
}

function memberChatPath(memberId) {
  const normalizedId = normalizeSquadMemberId(memberId);
  return normalizedId ? `/conversations/new?member=${encodeURIComponent(normalizedId)}` : "/conversations/new";
}

function memberProfilePath(memberId, section = "home") {
  return `${MEMBER_ROUTE_PREFIX}/${encodeURIComponent(normalizeSquadMemberId(memberId))}/${section}`;
}

function automationListPath(memberId) {
  return memberProfilePath(memberId, "triggers");
}

function automationDetailPath(memberId, automationId) {
  return `${automationListPath(memberId)}/${encodeURIComponent(automationId)}`;
}

function memberSectionFromRoute(route) {
  const match = route.match(/^\/squad-members\/[^/?#]+\/([^/?#]+)/);
  return match?.[1] || "home";
}

function memberAutomationIdFromRoute(route) {
  const match = route.match(/^\/squad-members\/[^/?#]+\/triggers\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function isCreateMemberRoute(route) {
  return route.startsWith(`${MEMBER_ROUTE_PREFIX}/new`);
}

function isMemberProfileRoute(route) {
  return route.startsWith(`${MEMBER_ROUTE_PREFIX}/`) && !route.startsWith(`${MEMBER_ROUTE_PREFIX}/new`);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { accept: "application/json", "content-type": "application/json" },
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!payload) {
    const text = await response.text().catch(() => "");
    const route = String(path || "").split("?")[0];
    throw new Error(
      text.trim().startsWith("<!doctype") || text.trim().startsWith("<html")
        ? `${route} returned the app shell instead of JSON. Restart the local Autohand Squad server so the latest API routes are active.`
        : `Request failed: ${response.status}`
    );
  }
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload.data;
}

function App() {
  const [route, setRoute] = useState(() => window.location.pathname + window.location.search);
  const [agents, setAgents] = useState(() => {
    const storedAgents = readStored(storageKeysFor("agents"), initialAgents);
    return mergeSeedAgents(storedAgents).map(normalizeAgentCopy);
  });
  const [tasks, setTasks] = useState(() => normalizeTasksCopy(mergeSeedTasks(readStored(storageKeysFor("tasks"), initialTasks))));
  const [automations, setAutomations] = useState(() => {
    const storedAutomations = readStored(storageKeysFor("automations"), initialAutomations);
    return (Array.isArray(storedAutomations) ? storedAutomations : initialAutomations).map((automation) =>
      normalizeAutomationCopy(automation)
    );
  });
  const [messagesByAgent, setMessagesByAgent] = useState(() =>
    normalizeMessageCopy(
      readStored(storageKeysFor("messages"), { [initialAgents[0].id]: initialMessages(initialAgents[0].name) })
    )
  );
  const [runs, setRuns] = useState([]);
  const [runtime, setRuntime] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [themePreference, setThemePreference] = useState(readThemePreference);
  const [handoffSettings, setHandoffSettings] = useState(readHandoffSettings);
  const [systemTheme, setSystemTheme] = useState(getSystemColorMode);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(
    () => readLocalStorage(storageKeysFor("sidebarCollapsed")) !== "false"
  );
  const [localePreference, setLocalePreference] = useState(readLocalePreference);
  const [systemLanguages, setSystemLanguages] = useState(getNavigatorLanguages);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const localeResolution = useMemo(
    () => resolveLocalePreference(localePreference, systemLanguages),
    [localePreference, systemLanguages]
  );
  const localeCopy = useMemo(() => getLocaleCopy(localeResolution.locale), [localeResolution.locale]);
  const theme = resolveEffectiveThemeMode(themePreference, systemTheme);
  const activeThemePreset = getThemePreset(themePreference, theme);

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onLanguageChange = () => setSystemLanguages(getNavigatorLanguages());
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, []);

  useEffect(() => {
    const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!colorScheme) return undefined;

    const updateSystemTheme = () => setSystemTheme(colorScheme.matches ? THEME_MODE_DARK : THEME_MODE_LIGHT);
    updateSystemTheme();
    colorScheme.addEventListener?.("change", updateSystemTheme);
    return () => colorScheme.removeEventListener?.("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === THEME_MODE_LIGHT);
    root.classList.toggle("dark", theme === THEME_MODE_DARK);
    root.dataset.themeMode = themePreference.mode;
    root.dataset.themeSurface = theme;
    root.dataset.themePreset = activeThemePreset.id;

    for (const tokenName of THEME_TOKEN_NAMES) {
      root.style.setProperty(`--${tokenName}`, activeThemePreset.tokens[tokenName]);
    }

    try {
      window.localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(themePreference));
    } catch {
      // Ignore storage failures in private browsing or locked-down webviews.
    }
  }, [activeThemePreset, theme, themePreference]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.handoffSettings, JSON.stringify(handoffSettings));
    } catch {
      // Ignore storage failures in private browsing or locked-down webviews.
    }
  }, [handoffSettings]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, desktopSidebarCollapsed ? "true" : "false");
  }, [desktopSidebarCollapsed]);

  useEffect(() => {
    function onSidebarShortcut(event) {
      if (event.defaultPrevented || event.repeat) return;
      if (event.key.toLowerCase() !== "b" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }

      event.preventDefault();
      setDesktopSidebarCollapsed((current) => !current);
    }

    window.addEventListener("keydown", onSidebarShortcut);
    return () => window.removeEventListener("keydown", onSidebarShortcut);
  }, []);

  useEffect(() => {
    document.documentElement.lang = localeResolution.locale;
    document.documentElement.dir = getLocaleDirection(localeResolution.locale);
    document.documentElement.dataset.locale = localeResolution.locale;
    try {
      window.localStorage.setItem(STORAGE_KEYS.locale, JSON.stringify(localePreference));
    } catch {
      // Ignore storage failures in private browsing or locked-down webviews.
    }
  }, [localePreference, localeResolution.locale]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.agents, JSON.stringify(agents));
  }, [agents]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.automations, JSON.stringify(automations));
  }, [automations]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(messagesByAgent));
  }, [messagesByAgent]);

  useEffect(() => {
    if (!runtime?.workspaceRoot) return;
    setAgents((current) => {
      let changed = false;
      const projectLimit = configuredProjectLimit(runtime);
      const next = current.map((agent) => {
        const workspace = normalizeSquadWorkspacePath(agent.workspace, runtime);
        const projects = normalizeAgentProjects(agent.projects, workspace, workspaces, projectLimit)
          .map((project) =>
            projectRecordFromPath({ ...project, path: normalizeSquadWorkspacePath(project.path, runtime) }, workspaces)
          )
          .filter((project) => project && !isBlockedWorkspace(project.path, runtime));
        const nextWorkspace = !isBlockedWorkspace(workspace, runtime) ? workspace : projects[0]?.path || "";
        const stats = { ...(agent.stats || {}), projects: projects.length };
        if (
          nextWorkspace === agent.workspace &&
          projectRecordsEqual(projects, agent.projects || []) &&
          stats.projects === agent.stats?.projects
        ) {
          return agent;
        }
        changed = true;
        return { ...agent, workspace: nextWorkspace, projects, stats };
      });
      return changed ? next : current;
    });
  }, [runtime, workspaces]);

  useEffect(() => {
    let cancelled = false;
    async function loadRuntime() {
      try {
        const data = await api("/api/runtime");
        if (!cancelled) setRuntime(data);
      } catch {
        if (!cancelled) setRuntime({ available: false, autohandPath: "", version: "" });
      }
    }
    loadRuntime();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspaces() {
      try {
        const data = await api("/api/workspaces");
        if (!cancelled) setWorkspaces(data);
      } catch {
        if (!cancelled) setWorkspaces([]);
      }
    }
    loadWorkspaces();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRuns() {
      try {
        const data = await api("/api/runs");
        if (!cancelled) setRuns(data);
      } catch {
        if (!cancelled) setRuns([]);
      }
    }
    loadRuns();
    const timer = window.setInterval(loadRuns, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const activeAgentId = useMemo(() => {
    const params = new URLSearchParams(route.split("?")[1] || "");
    const member = params.get("member") || params.get("squadMember");
    const profileMatch = route.match(/\/squad-members\/([^/?#]+)/);
    return normalizeSquadMemberId(profileMatch?.[1] || member || agents[0]?.id);
  }, [agents, route]);

  const activeAgent = agents.find((agent) => agent.id === activeAgentId) || agents[0];
  const activeRuns = runs.filter((run) => run.agentId === activeAgent?.id);
  const activeAutomations = automations.filter((automation) => automationBelongsToAgent(automation, activeAgent?.id));
  const fallbackWorkspace = getFallbackWorkspace(runtime, workspaces);
  const activeSection = useMemo(() => memberSectionFromRoute(route), [route]);
  const requestedWorkspace = useMemo(() => {
    const params = new URLSearchParams(route.split("?")[1] || "");
    return normalizeSquadWorkspacePath(params.get("workspace") || "", runtime);
  }, [route, runtime]);

  function navigate(path) {
    window.history.pushState({}, "", path);
    setRoute(path);
    setMobileSidebarOpen(false);
  }

  function openSettings() {
    setSettingsOpen(true);
  }

  function openAnalytics() {
    setSettingsOpen(false);
    navigate("/settings/analytics");
  }

  function updateAgent(agentId, patch) {
    setAgents((current) =>
      current.map((agent) => (agent.id === agentId ? { ...agent, ...patch } : agent))
    );
  }

  function touchAgent(agentId, timestamp = new Date().toISOString()) {
    updateAgent(agentId, { lastConversationAt: timestamp, updatedAt: timestamp });
  }

  function appendMessage(agentId, message) {
    setMessagesByAgent((current) => {
      const messageAgent = agents.find((item) => item.id === agentId) || activeAgent;
      const existing = current[agentId] || initialMessages(messageAgent?.name || "Squad member");
      return { ...current, [agentId]: [...existing, message] };
    });
  }

  function updateMessage(agentId, messageId, patch) {
    setMessagesByAgent((current) => {
      const existing = current[agentId] || [];
      return {
        ...current,
        [agentId]: existing.map((message) =>
          message.id === messageId ? { ...message, ...patch } : message
        ),
      };
    });
  }

  function startNewConversation(agentId) {
    const agent = agents.find((item) => item.id === agentId) || activeAgent;
    if (!agent) return;
    const timestamp = new Date().toISOString();
    setMessagesByAgent((current) => ({
      ...current,
      [agent.id]: initialMessages(agent.name),
    }));
    updateAgent(agent.id, { lastConversationAt: timestamp, updatedAt: timestamp });
    navigate(memberChatPath(agent.id));
  }

  async function sendChat(agentId, launch) {
    const agent = agents.find((item) => item.id === agentId) || activeAgent;
    const now = new Date();
    const time = now.toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" });
    const prompt = String(launch.prompt || "").trim();
    const selectedWorkspace = normalizeSquadWorkspacePath(launch.workspace || fallbackWorkspace, runtime);
    if (!prompt) return;

    const id = `chat-${Date.now().toString(36)}`;
    touchAgent(agentId, now.toISOString());
    appendMessage(agentId, { id: `${id}-u`, role: "user", body: prompt, time });
    appendMessage(agentId, {
      id: `${id}-a`,
      role: "agent",
      body: `${agent.name} is thinking...`,
      status: "loading",
      time,
    });

    try {
      const reply = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          agentId,
          prompt,
          workspace: selectedWorkspace,
          policy: launch.policy,
          model: launch.model,
          profile: buildAgentProfile(agent, selectedWorkspace),
          agent: agentLaunchPayload(agent),
        }),
      });
      const replyTime = new Date().toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" });
      updateMessage(agentId, `${id}-a`, {
        body: reply.reply || `${agent.name} returned no chat text.`,
        trace: reply.trace || null,
        command: reply.command || "",
        workspace: reply.workspace || selectedWorkspace,
        status: "complete",
        time: replyTime,
      });
    } catch (error) {
      updateMessage(agentId, `${id}-a`, {
        body: `${agent.name} could not answer: ${error.message}`,
        status: "error",
      });
    }
  }

  async function createAgent(draft) {
    const id = createSquadMemberId();
    const timestamp = new Date().toISOString();
    const skills = normalizeSkillList(draft.skills);
    const workspace = normalizeSquadWorkspacePath(draft.workspace || fallbackWorkspace, runtime);
    const projects = normalizeAgentProjects([{ path: workspace, addedAt: timestamp }], "", workspaces, configuredProjectLimit(runtime));
    const baseAgent = {
      id,
      staffId: `member-${String(agents.length + 1).padStart(3, "0")}`,
      name: draft.name.trim(),
      role: draft.role,
      status: "online",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastConversationAt: timestamp,
      avatar: draft.avatar,
      employeeType: draft.employeeType,
      workspace,
      projects,
      description: draft.description.trim(),
      instructions: draft.instructions.trim(),
      skillSource: draft.skillSource || AUTOHAND_SKILLS_REGISTRY_URL,
      launch: { mode: "prompt", policy: "restricted", model: "", dryRun: false },
      permissions: createDefaultPermissionState(),
      stats: { activeDays: 0, automations: 0, tasks: 0, projects: projects.length },
      memory: ["Created from Autohand Squad.", `Autohand Skills Source: ${AUTOHAND_SKILLS_REGISTRY_URL}`],
      skills,
      skillInstall: { source: AUTOHAND_SKILLS_REGISTRY_URL, requested: skills, installed: [], failed: [], status: "pending" },
      tools: [
        { name: "Autohand CLI", policy: "restricted", status: "isolated" },
        { name: "Terminal", policy: "manual", status: "wired" },
        { name: "Browser", policy: "allow", status: "ready" },
      ],
    };
    const agent = {
      ...baseAgent,
      profileFiles: buildAgentProfileFiles({ ...baseAgent, profileFiles: draft.profileFiles }),
    };
    setAgents((current) => [...current, agent]);
    setMessagesByAgent((current) => ({ ...current, [id]: initialMessages(agent.name) }));
    navigate(memberChatPath(id));

    try {
      const provision = await api("/api/agents/provision", {
        method: "POST",
        body: JSON.stringify({
          agentId: id,
          workspace: agent.workspace,
          profile: buildAgentProfile(agent, agent.workspace),
          agent: agentLaunchPayload(agent),
        }),
      });
      const installedMemory = (provision.skillInstall?.installed || []).map((skill) => `Autohand Skill Installed: ${skill.id}`);
      const failedMemory = (provision.skillInstall?.failed || []).map((skill) => `Autohand Skill Install Failed: ${skill.id}`);
      updateAgent(id, {
        skillInstall: { ...provision.skillInstall, status: provision.skillInstall?.failed?.length ? "partial" : "installed" },
        profileDocs: provision.profileDocs,
        memory: Array.from(new Set([...agent.memory, ...installedMemory, ...failedMemory])),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      updateAgent(id, {
        skillInstall: {
          source: AUTOHAND_SKILLS_REGISTRY_URL,
          requested: skills,
          installed: [],
          failed: [{ id: "provision", reason: error.message }],
          status: "failed",
        },
        memory: Array.from(new Set([...agent.memory, `Autohand Skill Install Failed: ${error.message}`])),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async function startAutohand(agentId, launch) {
    const agent = agents.find((item) => item.id === agentId) || activeAgent;
    const now = new Date();
    const time = now.toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" });
    const prompt = String(launch.prompt || "").trim();
    const selectedWorkspace = normalizeSquadWorkspacePath(launch.workspace || fallbackWorkspace, runtime);
    const taskId = `task-${Date.now().toString().slice(-5)}`;

    touchAgent(agentId, now.toISOString());
    appendMessage(agentId, { id: `${taskId}-u`, role: "user", body: prompt, time });
    setTasks((current) => [
      {
        id: taskId,
        title: prompt.length > 72 ? `${prompt.slice(0, 69)}...` : prompt,
        agentId,
        currentOwnerId: agentId,
        originAgentId: agentId,
        project: workspaceLabel(selectedWorkspace, workspaces),
        status: "launching",
        source: launch.mode === "auto" ? "automation" : "conversation",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        summary: "Starting Autohand CLI...",
        runtimeId: null,
        assignments: [
          {
            id: `${taskId}-assignment-root`,
            agentId,
            sourceAgentId: agentId,
            status: "running",
            reason: "Initial Autohand run",
            requiredContext: prompt,
            expectedOutput: "Complete the requested work and report validation evidence.",
            sourceEvidence: "",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            attempt: 1,
          },
        ],
        handoffs: [],
        timeline: [
          {
            id: `${taskId}-created`,
            type: "task.created",
            at: now.toISOString(),
            actorAgentId: agentId,
            targetAgentId: agentId,
            summary: "Parent task created from conversation.",
          },
          {
            id: `${taskId}-run-starting`,
            type: "run.starting",
            at: now.toISOString(),
            actorAgentId: agentId,
            targetAgentId: agentId,
            summary: "Initial child run requested.",
          },
        ],
      },
      ...current,
    ]);
    setTaskPanelOpen(true);

    try {
      const run = await api("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          agentId,
          title: prompt,
          prompt,
          workspace: selectedWorkspace,
          mode: launch.mode,
          policy: launch.policy,
          model: launch.model,
          dryRun: launch.dryRun,
          profile: buildAgentProfile(agent, selectedWorkspace),
          agent: agentLaunchPayload(agent),
        }),
      });
      setRuns((current) => [run, ...current]);
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: "running",
                runtimeId: run.id,
                summary: run.command,
                assignments: (task.assignments || []).map((assignment, index) =>
                  index === (task.assignments || []).length - 1
                    ? { ...assignment, runId: run.id, status: "running", updatedAt: new Date().toISOString() }
                    : assignment
                ),
                timeline: [
                  ...(task.timeline || []),
                  {
                    id: `${task.id}-run-${run.id}`,
                    type: "run.started",
                    at: new Date().toISOString(),
                    actorAgentId: agentId,
                    targetAgentId: agentId,
                    runId: run.id,
                    summary: `Child run started with ${run.displayConfigPath || run.configPath || "isolated config"}.`,
                  },
                ],
              }
            : task
        )
      );
      appendMessage(agentId, {
        id: `${taskId}-a`,
        role: "agent",
        body: `${agent.name} started Autohand in ${launch.modeLabel || launch.mode}. Runtime id: ${run.id.slice(0, 8)}. Config: ${run.displayConfigPath || run.configPath || "isolated"}.`,
        time,
      });
      updateAgent(agentId, {
        stats: {
          ...agent.stats,
          tasks: agent.stats.tasks + 1,
        },
      });
    } catch (error) {
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId ? { ...task, status: "failed", summary: error.message } : task
        )
      );
      appendMessage(agentId, {
        id: `${taskId}-err`,
        role: "agent",
        body: `Autohand did not start: ${error.message}`,
        time,
      });
    }
  }

  function createHandoff(source, draft) {
    const timestamp = new Date().toISOString();
    const sourceTask =
      source?.task ||
      tasks.find((task) => task.id === source?.taskId || (source?.run?.id && task.runtimeId === source.run.id));
    const sourceRun = source?.run;
    const sourceAgentId = normalizeSquadMemberId(
      source?.sourceAgentId || sourceTask?.currentOwnerId || sourceTask?.agentId || sourceRun?.agentId || activeAgent?.id
    );
    const targetAgentId = normalizeSquadMemberId(draft.targetAgentId);
    const sourceAgent = agents.find((agent) => agent.id === sourceAgentId) || activeAgent;
    const targetAgent = agents.find((agent) => agent.id === targetAgentId);
    if (!targetAgent || !targetAgentId || targetAgentId === sourceAgentId) return;

    const baseTask = normalizeTaskCopy(
      sourceTask || {
        id: `task-handoff-${Date.now().toString(36)}`,
        title: sourceRun?.title || draft.title || "Handoff from run",
        agentId: sourceAgentId,
        currentOwnerId: sourceAgentId,
        originAgentId: sourceAgentId,
        project: workspaceLabel(sourceRun?.workspace || fallbackWorkspace, workspaces),
        status: sourceRun?.status === "failed" ? "failed" : "running",
        source: sourceRun ? "run-handoff" : "conversation",
        createdAt: sourceRun?.startedAt || timestamp,
        updatedAt: timestamp,
        summary: sourceRun?.command || draft.requiredContext || "Run prepared for handoff.",
        runtimeId: sourceRun?.id || null,
      }
    );
    const handoffId = `handoff-${Date.now().toString(36)}`;
    const handoff = {
      id: handoffId,
      fromAgentId: sourceAgentId,
      toAgentId: targetAgentId,
      status: "pending",
      reason: String(draft.reason || "").trim(),
      requiredContext: String(draft.requiredContext || "").trim(),
      expectedOutput: String(draft.expectedOutput || "").trim(),
      sourceEvidence: String(draft.sourceEvidence || "").trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
      checkpointId: `checkpoint-${handoffId}`,
      attempt: 1,
    };
    const assignment = {
      id: `assignment-${handoffId}`,
      agentId: targetAgentId,
      sourceAgentId,
      status: "pending",
      reason: handoff.reason,
      requiredContext: handoff.requiredContext,
      expectedOutput: handoff.expectedOutput,
      sourceEvidence: handoff.sourceEvidence,
      createdAt: timestamp,
      updatedAt: timestamp,
      attempt: 1,
      handoffId,
    };
    const priorTimeline = Array.isArray(baseTask.timeline) ? baseTask.timeline : [];
    const priorHandoffs = Array.isArray(baseTask.handoffs) ? baseTask.handoffs : [];
    const priorAssignments = Array.isArray(baseTask.assignments) ? baseTask.assignments : [];
    const reroutedHandoffId = source?.handoff?.id;
    const nextTask = {
      ...baseTask,
      agentId: targetAgentId,
      currentOwnerId: targetAgentId,
      originAgentId: baseTask.originAgentId || sourceAgentId,
      status: "handoff-pending",
      updatedAt: timestamp,
      summary: `Handoff to ${targetAgent.name}: ${handoff.reason || "continue the parent task"}`,
      handoffs: [
        ...priorHandoffs.map((item) =>
          reroutedHandoffId && item.id === reroutedHandoffId
            ? { ...item, status: "rerouted", updatedAt: timestamp }
            : item
        ),
        handoff,
      ],
      assignments: [...priorAssignments, assignment],
      timeline: [
        ...priorTimeline,
        ...(reroutedHandoffId
          ? [
              {
                id: `timeline-${Date.now().toString(36)}-reroute`,
                type: "handoff.rerouted",
                at: timestamp,
                actorAgentId: sourceAgentId,
                targetAgentId,
                summary: `Rerouted handoff to ${targetAgent.name}.`,
              },
            ]
          : []),
        {
          id: `timeline-${Date.now().toString(36)}-handoff`,
          type: "handoff.created",
          at: timestamp,
          actorAgentId: sourceAgentId,
          targetAgentId,
          handoffId,
          summary: `${sourceAgent?.name || "Squad member"} handed this to ${targetAgent.name}.`,
          content: handoffContextText(handoff, baseTask, sourceAgent, targetAgent),
        },
      ],
    };

    setTasks((current) => {
      const taskExists = current.some((task) => task.id === nextTask.id);
      if (!taskExists) return [nextTask, ...current];
      return current.map((task) => (task.id === nextTask.id ? nextTask : task));
    });
    const time = new Date(timestamp).toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" });
    appendMessage(targetAgentId, {
      id: `${handoffId}-received`,
      role: "agent",
      body: handoffContextText(handoff, nextTask, sourceAgent, targetAgent),
      time,
      status: "handoff",
    });
    appendMessage(sourceAgentId, {
      id: `${handoffId}-sent`,
      role: "agent",
      body: `Handoff queued for ${targetAgent.name}. Parent task stays as ${compactRecordId(nextTask.id)}; ${targetAgent.name} is now the current owner.`,
      time,
      status: "handoff",
    });
    touchAgent(targetAgentId, timestamp);
    touchAgent(sourceAgentId, timestamp);
    setTaskPanelOpen(true);
  }

  function cancelHandoff(task, handoff) {
    if (!task || !handoff) return;
    const timestamp = new Date().toISOString();
    const sourceAgent = agents.find((agent) => agent.id === handoff.fromAgentId);
    const targetAgent = agents.find((agent) => agent.id === handoff.toAgentId);
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? {
              ...item,
              agentId: handoff.fromAgentId,
              currentOwnerId: handoff.fromAgentId,
              status: "pending",
              updatedAt: timestamp,
              summary: `Handoff to ${targetAgent?.name || "target squad member"} cancelled.`,
              handoffs: item.handoffs.map((record) =>
                record.id === handoff.id ? { ...record, status: "cancelled", updatedAt: timestamp } : record
              ),
              assignments: item.assignments.map((assignment) =>
                assignment.handoffId === handoff.id ? { ...assignment, status: "cancelled", updatedAt: timestamp } : assignment
              ),
              timeline: [
                ...(item.timeline || []),
                {
                  id: `timeline-${Date.now().toString(36)}-cancel`,
                  type: "handoff.cancelled",
                  at: timestamp,
                  actorAgentId: handoff.fromAgentId,
                  targetAgentId: handoff.toAgentId,
                  handoffId: handoff.id,
                  summary: `${sourceAgent?.name || "Source"} cancelled the handoff to ${targetAgent?.name || "target"}.`,
                },
              ],
            }
          : item
      )
    );
  }

  function markHandoffFailed(task, handoff, failureReason = "Receiving agent could not continue from the checkpoint.") {
    if (!task || !handoff) return;
    const timestamp = new Date().toISOString();
    const targetAgent = agents.find((agent) => agent.id === handoff.toAgentId);
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: "blocked",
              updatedAt: timestamp,
              summary: `Blocked handoff to ${targetAgent?.name || "target squad member"}: ${failureReason}`,
              handoffs: item.handoffs.map((record) =>
                record.id === handoff.id ? { ...record, status: "failed", failureReason, updatedAt: timestamp } : record
              ),
              assignments: item.assignments.map((assignment) =>
                assignment.handoffId === handoff.id ? { ...assignment, status: "failed", failureReason, updatedAt: timestamp } : assignment
              ),
              timeline: [
                ...(item.timeline || []),
                {
                  id: `timeline-${Date.now().toString(36)}-failed`,
                  type: "handoff.failed",
                  at: timestamp,
                  actorAgentId: handoff.toAgentId,
                  targetAgentId: handoff.toAgentId,
                  handoffId: handoff.id,
                  summary: `Handoff checkpoint failed: ${failureReason}`,
                },
              ],
            }
          : item
      )
    );
  }

  function retryHandoff(task, handoff) {
    if (!task || !handoff) return;
    const retryMode = resolveHandoffRetryMode(handoffSettings, runtime);
    if (retryMode !== "checkpoint") return;
    const timestamp = new Date().toISOString();
    const targetAgent = agents.find((agent) => agent.id === handoff.toAgentId);
    const sourceAgent = agents.find((agent) => agent.id === handoff.fromAgentId);
    const attempt = (Number(handoff.attempt) || 1) + 1;
    const retriedHandoff = { ...handoff, status: "pending", attempt, updatedAt: timestamp };
    setTasks((current) =>
      current.map((item) =>
        item.id === task.id
          ? {
              ...item,
              agentId: handoff.toAgentId,
              currentOwnerId: handoff.toAgentId,
              status: "handoff-pending",
              updatedAt: timestamp,
              summary: `Retrying checkpoint handoff to ${targetAgent?.name || "target squad member"} (attempt ${attempt}).`,
              handoffs: item.handoffs.map((record) => (record.id === handoff.id ? retriedHandoff : record)),
              assignments: item.assignments.map((assignment) =>
                assignment.handoffId === handoff.id ? { ...assignment, status: "pending", attempt, updatedAt: timestamp } : assignment
              ),
              timeline: [
                ...(item.timeline || []),
                {
                  id: `timeline-${Date.now().toString(36)}-retry`,
                  type: "handoff.retried",
                  at: timestamp,
                  actorAgentId: handoff.fromAgentId,
                  targetAgentId: handoff.toAgentId,
                  handoffId: handoff.id,
                  summary: `Retried failed checkpoint for ${targetAgent?.name || "target"} with preserved context.`,
                },
              ],
            }
          : item
      )
    );
    appendMessage(handoff.toAgentId, {
      id: `${handoff.id}-retry-${attempt}`,
      role: "agent",
      body: `${handoffContextText(retriedHandoff, task, sourceAgent, targetAgent)}\n\nFailure reason from previous attempt: ${handoff.failureReason || "not recorded"}`,
      time: new Date(timestamp).toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" }),
      status: "handoff",
    });
    touchAgent(handoff.toAgentId, timestamp);
  }

  async function openTerminal(agent, prompt = "") {
    const workspace = normalizeSquadWorkspacePath(agent.workspace || fallbackWorkspace, runtime);
    await api("/api/terminal", {
      method: "POST",
      body: JSON.stringify({
        workspace,
        prompt,
        profile: buildAgentProfile(agent, workspace),
        agent: agentLaunchPayload(agent),
      }),
    });
  }

  async function runAutomation(automation) {
    const workspace = automation.workspace || workspacePath(automation.target, workspaces, fallbackWorkspace);
    await startAutohand(activeAgent.id, {
      prompt: automation.prompt,
      workspace,
      mode: "auto",
      modeLabel: "Auto",
      policy: "restricted",
      model: automation.model === "auto" ? "" : automation.model,
      dryRun: false,
    });
    const timestamp = new Date().toISOString();
    setAutomations((current) =>
      current.map((item) =>
        item.id === automation.id
          ? {
              ...item,
              runCount: (Number(item.runCount) || 0) + 1,
              lastRun: timestamp,
              updatedAt: timestamp,
              runHistory: [
                {
                  id: `run_${timestamp}`,
                  time: timestamp,
                  summary: "Manual run started from Automations.",
                  source: "manual",
                },
                ...(Array.isArray(item.runHistory) ? item.runHistory : []),
              ].slice(0, 20),
            }
          : item
      )
    );
  }

  const isProfile = isMemberProfileRoute(route);
  const isCreate = isCreateMemberRoute(route);
  const isExtensions = route.startsWith("/extensions");
  const isAnalytics = route.startsWith("/settings/analytics");

  return (
    <TooltipProvider>
      <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
        <div className={cn("dark-grid pointer-events-none fixed inset-0 opacity-35", isCreate && "hidden")} />
        <div className="pointer-events-none fixed inset-x-0 top-0 h-px signal-line" />
        <div
          className={cn(
            "relative grid min-h-screen transition-[grid-template-columns] duration-200 ease-out",
            desktopSidebarCollapsed ? "lg:grid-cols-[72px_minmax(0,1fr)]" : "lg:grid-cols-[280px_minmax(0,1fr)]"
          )}
        >
          <DesktopSidebar
            agents={agents}
            activeAgent={activeAgent}
            collapsed={desktopSidebarCollapsed}
            navigate={navigate}
            route={route}
            runtime={runtime}
            runs={runs}
            theme={theme}
            locale={localeResolution.locale}
            copy={localeCopy}
            onSettings={() => openSettings()}
            onAnalytics={openAnalytics}
            onCollapsedChange={setDesktopSidebarCollapsed}
          />
          <main className="min-w-0">
            <MobileTopbar
              activeAgent={activeAgent}
              theme={theme}
              copy={localeCopy}
              onMenu={() => setMobileSidebarOpen(true)}
              onSettings={() => openSettings()}
              onAnalytics={openAnalytics}
            />
            {isAnalytics ? (
              <SettingsAnalyticsPage locale={localeResolution.locale} copy={localeCopy} />
            ) : isCreate ? (
              <CreateAgent
                onCreate={createAgent}
                onCancel={() => navigate("/conversations/new")}
                defaultWorkspace={fallbackWorkspace}
                workspaceRoot={runtime?.workspaceRoot}
              />
            ) : isProfile ? (
              <SquadMemberPage
                agent={activeAgent}
                agents={agents}
                section={activeSection}
                tasks={tasks.filter((task) => taskBelongsToAgent(task, activeAgent?.id))}
                automations={activeAutomations}
                setAutomations={setAutomations}
                runtime={runtime}
                workspaces={workspaces}
                runs={activeRuns}
                route={route}
                locale={localeResolution.locale}
                copy={localeCopy}
                navigate={navigate}
                openTerminal={openTerminal}
                updateAgent={updateAgent}
                startAutohand={startAutohand}
                runAutomation={runAutomation}
              />
            ) : isExtensions ? (
              <Extensions runtime={runtime} runs={runs} />
            ) : (
              <Conversation
                agent={activeAgent}
                messages={messagesByAgent[activeAgent?.id] || []}
                agents={agents}
                runtime={runtime}
                workspaces={workspaces}
                runs={activeRuns}
                locale={localeResolution.locale}
                copy={localeCopy}
                onStart={startAutohand}
                onChat={sendChat}
                onNewConversation={startNewConversation}
                openTerminal={openTerminal}
                navigate={navigate}
                taskPanelOpen={taskPanelOpen}
                setTaskPanelOpen={setTaskPanelOpen}
                tasks={tasks.filter((task) => taskBelongsToAgent(task, activeAgent?.id))}
                automations={activeAutomations}
                setAutomations={setAutomations}
                runAutomation={runAutomation}
                requestedWorkspace={requestedWorkspace}
                handoffRetryMode={resolveHandoffRetryMode(handoffSettings, runtime)}
                onCreateHandoff={createHandoff}
                onCancelHandoff={cancelHandoff}
                onFailHandoff={markHandoffFailed}
                onRetryHandoff={retryHandoff}
              />
            )}
          </main>
        </div>

        <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="w-[310px] border-border/80 p-0 sm:max-w-[310px]">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Autohand Squad navigation</SheetDescription>
            </SheetHeader>
            <SidebarContent
              agents={agents}
              activeAgent={activeAgent}
              navigate={navigate}
              route={route}
              runtime={runtime}
              runs={runs}
              theme={theme}
              locale={localeResolution.locale}
              copy={localeCopy}
              onSettings={() => openSettings()}
              onAnalytics={openAnalytics}
            />
          </SheetContent>
        </Sheet>

        <SettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          themePreference={themePreference}
          setThemePreference={setThemePreference}
          handoffSettings={handoffSettings}
          setHandoffSettings={setHandoffSettings}
          effectiveTheme={theme}
          systemTheme={systemTheme}
          localePreference={localePreference}
          setLocalePreference={setLocalePreference}
          localeResolution={localeResolution}
          copy={localeCopy}
          runtime={runtime}
          navigate={navigate}
        />
      </div>
    </TooltipProvider>
  );
}

function workspaceName(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean)
    .at(-1);
}

function normalizePath(path) {
  return String(path || "").replace(/\/+$/, "");
}

function normalizeSquadWorkspacePath(path, runtime) {
  const value = normalizePath(path);
  const workspaceRoot = normalizePath(runtime?.workspaceRoot);
  if (!value || !workspaceRoot) return value;

  const squadRoot = normalizePath(runtime?.squadWorkspaceRoot || `${workspaceRoot}/${SQUAD_WORKSPACE_DIR_NAME}`);
  const legacyRoots = Array.isArray(runtime?.legacySquadWorkspaceRoots) && runtime.legacySquadWorkspaceRoots.length
    ? runtime.legacySquadWorkspaceRoots
    : LEGACY_SQUAD_WORKSPACE_DIR_NAMES.map((name) => `${workspaceRoot}/${name}`);

  for (const legacyRoot of legacyRoots.map(normalizePath)) {
    if (value === legacyRoot || value.startsWith(`${legacyRoot}/`)) {
      return `${squadRoot}${value.slice(legacyRoot.length)}`;
    }
  }

  return value;
}

function isBlockedWorkspace(path, runtime) {
  if (!path) return true;
  const workspaceRoot = normalizePath(runtime?.workspaceRoot);
  return Boolean(workspaceRoot && normalizePath(path) === workspaceRoot);
}

function getFallbackWorkspace(runtime, workspaces) {
  const runtimeDefault = runtime?.defaultWorkspace;
  if (runtimeDefault && !isBlockedWorkspace(runtimeDefault, runtime)) return runtimeDefault;
  return workspaces.find((workspace) => workspace.launchable !== false && !isBlockedWorkspace(workspace.path, runtime))?.path || "";
}

function getAgentWorkspace(agent, runtime, workspaces) {
  const workspace = normalizeSquadWorkspacePath(agent?.workspace, runtime);
  if (!isBlockedWorkspace(workspace, runtime)) return workspace;
  const project = normalizeAgentProjects(agent?.projects, "", workspaces).find(
    (item) => !isBlockedWorkspace(item.path, runtime)
  );
  return project?.path || getFallbackWorkspace(runtime, workspaces);
}

function workspaceOptions(workspaces, selected, runtime) {
  const normalizedSelected = normalizeSquadWorkspacePath(selected, runtime);
  const list = (Array.isArray(workspaces) ? workspaces : []).filter(
    (workspace) => workspace.launchable !== false && !isBlockedWorkspace(workspace.path, runtime)
  );
  if (!normalizedSelected || list.some((workspace) => workspace.path === normalizedSelected)) return list;
  if (isBlockedWorkspace(normalizedSelected, runtime)) return list;
  const name = workspaceName(normalizedSelected) || normalizedSelected;
  return [{ label: name, name, path: normalizedSelected, depth: 0, kind: "folder", launchable: true }, ...list];
}

function workspaceLabel(path, workspaces = []) {
  const match = workspaces.find((workspace) => workspace.path === path);
  return match?.label || workspaceName(path) || "workspace";
}

function workspacePath(target, workspaces = [], fallback = "") {
  const needle = String(target || "").toLowerCase();
  const match = workspaces.find((workspace) => {
    const label = String(workspace.label || "").toLowerCase();
    const name = String(workspace.name || "").toLowerCase();
    const path = String(workspace.path || "").toLowerCase();
    return needle && (needle.includes(label) || needle.includes(name) || needle.includes(path));
  });
  return match?.path || fallback || workspaces[0]?.path || "";
}

function agentSidebarPreview(agent) {
  return agent?.description || agent?.instructions || agent?.role || "Ready for local Autohand work.";
}

function agentSidebarTime(agent, locale = DEFAULT_LOCALE) {
  const raw = agent?.lastConversationAt || agent?.updatedAt || agent?.createdAt;
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function localizedRole(agent, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  const key = agent?.employeeType || String(agent?.role || "").toLowerCase().replace(/\s+/g, "-");
  return copy.roleLabels?.[key] || agent?.role || "";
}

function localizedSectionLabel(id, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  if (id === "project") return copy.projects || "Projects";
  return copy.sectionLabels?.[id] || MEMBER_SECTIONS.find((item) => item.id === id)?.label || id;
}

function localizedSkillLabel(skill, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  const normalized = normalizeSkillId(skill);
  return copy.skillLabels?.[normalized] || normalized.replaceAll("-", " ");
}

function localizedAgentInstructions(agent, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  if (agent?.employeeType === "common-qa-engineer" || agent?.role === "QA Engineer") {
    return copy.qaAgentInstructions;
  }
  if (agent?.employeeType === "backend-engineer" || agent?.role === "Backend Engineer") {
    return copy.backendAgentInstructions;
  }
  return agent?.instructions || "";
}

function localizedMessage(message, agent, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  const readyBody = `${agent?.name || "Squad member"} is online. Pick a workspace, chat normally, or use the play button when you want an explicit Autohand run. Both paths use this squad member's isolated config.`;
  return {
    ...message,
    body: message?.body === readyBody ? formatCopy(copy.agentOnlineMessage, { name: agent?.name || copy.squadMember }) : message?.body,
    time: message?.time === "Ready" ? copy.ready : message?.time,
  };
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function traceText(value) {
  return typeof value === "string" ? value : "";
}

function traceArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTrace(trace) {
  if (!trace || typeof trace !== "object") {
    return { steps: [], thoughts: [], toolCalls: [], toolResults: [], messages: [], events: [], raw: { stdout: "", stderr: "" } };
  }

  return {
    steps: traceArray(trace.steps)
      .map((step) => ({
        index: Number.isFinite(Number(step?.index)) ? Number(step.index) : null,
        title: String(step?.title || "").trim(),
      }))
      .filter((step) => step.title),
    thoughts: traceArray(trace.thoughts)
      .map((item) => ({
        thought: String(item?.thought || item?.content || "").trim(),
        reflection: String(item?.reflection || "").trim(),
        timestamp: String(item?.timestamp || ""),
      }))
      .filter((item) => item.thought || item.reflection),
    toolCalls: traceArray(trace.toolCalls)
      .map((call) => ({
        id: String(call?.id || ""),
        name: String(call?.name || call?.tool || "tool"),
        args: call?.args ?? call?.arguments ?? {},
        timestamp: String(call?.timestamp || ""),
      }))
      .filter((call) => call.name),
    toolResults: traceArray(trace.toolResults)
      .map((result) => ({
        id: String(result?.id || result?.tool_call_id || ""),
        name: String(result?.name || "tool"),
        content: String(result?.content || ""),
        timestamp: String(result?.timestamp || ""),
      }))
      .filter((result) => result.content),
    messages: traceArray(trace.messages)
      .map((event) => ({
        role: String(event?.role || "assistant"),
        content: String(event?.content || ""),
        timestamp: String(event?.timestamp || ""),
      }))
      .filter((event) => event.content),
    events: traceArray(trace.events)
      .map((event) => ({
        type: String(event?.type || ""),
        title: String(event?.title || ""),
        timestamp: String(event?.timestamp || ""),
        content: String(event?.content || ""),
        thought: String(event?.thought || ""),
        reflection: String(event?.reflection || ""),
        call: event?.call || null,
        result: event?.result || null,
        index: Number.isFinite(Number(event?.index)) ? Number(event.index) : null,
      }))
      .filter((event) => event.type),
    raw: {
      stdout: traceText(trace.raw?.stdout),
      stderr: traceText(trace.raw?.stderr),
    },
  };
}

function parseStepLine(line) {
  const match = String(line || "").trim().match(/^(?:[-*]\s*)?(?:->|→|›)?\s*step\s+(\d+)\s*:\s*(.+)$/i);
  if (!match) return null;
  return { index: Number(match[1]), title: match[2].trim() };
}

function parseAgentBody(body) {
  const text = String(body || "").trim();
  const parsed = parseJsonText(text);
  const structured = parsed && typeof parsed === "object" ? parsed : null;
  const steps = [];
  const thoughts = [];
  const toolCalls = [];
  const answerLines = [];

  if (structured) {
    if (structured.thought || structured.reflection) {
      thoughts.push({
        thought: String(structured.thought || "").trim(),
        reflection: String(structured.reflection || "").trim(),
        timestamp: String(structured.timestamp || ""),
      });
    }
    for (const call of traceArray(structured.toolCalls)) {
      toolCalls.push({
        id: String(call?.id || call?.tool_call_id || ""),
        name: String(call?.tool || call?.name || "tool"),
        args: call?.args ?? call?.arguments ?? {},
        timestamp: String(call?.timestamp || ""),
      });
    }
    return {
      answer: String(structured.answer || structured.response || structured.content || "").trim(),
      steps,
      thoughts,
      toolCalls,
    };
  }

  for (const line of String(body || "").split(/\r?\n/)) {
    const step = parseStepLine(line);
    if (step) {
      steps.push(step);
      continue;
    }
    answerLines.push(line);
  }

  return {
    answer: answerLines.join("\n").trim(),
    steps,
    thoughts,
    toolCalls,
  };
}

function uniqueTraceItems(items, keyForItem) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyForItem(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildAgentResponseView(message) {
  const trace = normalizeTrace(message.trace);
  const parsedBody = parseAgentBody(message.body);
  const answer = parsedBody.answer || String(message.body || "").trim();
  const steps = uniqueTraceItems([...trace.steps, ...parsedBody.steps], (step) => `${step.index || ""}:${step.title}`);
  const thoughts = uniqueTraceItems([...trace.thoughts, ...parsedBody.thoughts], (item) => `${item.thought}:${item.reflection}`);
  const toolCalls = uniqueTraceItems([...trace.toolCalls, ...parsedBody.toolCalls], (call) => `${call.id}:${call.name}:${stringifyTraceValue(call.args)}`);
  const assistantEvents = trace.messages.filter((event) => event.content.trim() && event.content.trim() !== answer.trim());

  return {
    answer,
    steps,
    thoughts,
    toolCalls,
    toolResults: trace.toolResults,
    assistantEvents,
    orderedEvents: buildOrderedWorkEvents({ trace, parsedBody, answer }),
    raw: trace.raw,
  };
}

function buildOrderedWorkEvents({ trace, parsedBody, answer }) {
  const resultById = new Map();
  const resultByName = new Map();
  for (const result of trace.toolResults) {
    if (result.id) resultById.set(result.id, result);
    resultByName.set(result.name, result);
  }

  const eventSource = trace.events.length
    ? trace.events
    : [
        ...trace.steps.map((step) => ({ type: "step", index: step.index, title: step.title })),
        ...parsedBody.steps.map((step) => ({ type: "step", index: step.index, title: step.title })),
        ...trace.thoughts.map((item) => ({ type: "thought", ...item })),
        ...parsedBody.thoughts.map((item) => ({ type: "thought", ...item })),
        ...trace.toolCalls.map((call) => ({ type: "tool_call", call })),
        ...parsedBody.toolCalls.map((call) => ({ type: "tool_call", call })),
        ...trace.messages.map((event) => ({ type: "assistant_event", ...event })),
      ];

  return uniqueTraceItems(
    eventSource
      .map((event, index) => {
        if (event.type === "tool_call") {
          const call = event.call || event;
          const result = call?.id ? resultById.get(call.id) : resultByName.get(call?.name);
          return { ...event, call, result, order: index };
        }
        return { ...event, order: index };
      })
      .filter((event) => {
        if (event.type === "step") return event.title;
        if (event.type === "thought") return event.thought || event.reflection;
        if (event.type === "tool_call") return event.call?.name;
        if (event.type === "assistant_event") {
          return event.content.trim() && event.content.trim() !== String(answer || "").trim();
        }
        return false;
      })
      .sort((first, second) => {
        const firstTime = Date.parse(first.timestamp || first.call?.timestamp || "");
        const secondTime = Date.parse(second.timestamp || second.call?.timestamp || "");
        if (!Number.isNaN(firstTime) && !Number.isNaN(secondTime) && firstTime !== secondTime) {
          return firstTime - secondTime;
        }
        return first.order - second.order;
      }),
    (event) => {
      if (event.type === "tool_call") return `tool:${event.call?.id || ""}:${event.call?.name || ""}:${stringifyTraceValue(event.call?.args)}`;
      if (event.type === "step") return `step:${event.index || ""}:${event.title}`;
      if (event.type === "thought") return `thought:${event.thought}:${event.reflection}`;
      return `${event.type}:${event.content || event.title || event.timestamp || event.order}`;
    }
  );
}

function stringifyTraceValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatShortTime(value, locale = DEFAULT_LOCALE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function parseMarkdownBlocks(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let listItems = [];
  let codeLines = null;
  let codeLanguage = "";

  function flushParagraph() {
    const value = paragraph.join("\n").trim();
    if (value) blocks.push({ type: "paragraph", text: value });
    paragraph = [];
  }

  function flushList() {
    if (listItems.length) blocks.push({ type: "list", items: listItems });
    listItems = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const fence = trimmed.match(/^```([A-Za-z0-9_-]*)/);

    if (codeLines) {
      if (fence) {
        blocks.push({ type: "code", language: codeLanguage, code: codeLines.join("\n") });
        codeLines = null;
        codeLanguage = "";
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (fence) {
      flushParagraph();
      flushList();
      codeLines = [];
      codeLanguage = fence[1] || "";
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", depth: heading[1].length, text: heading[2] });
      continue;
    }

    const listMatch = line.match(/^(\s*)(?:[-*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      listItems.push({
        level: Math.min(Math.floor(listMatch[1].length / 2), 3),
        text: listMatch[2],
      });
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (codeLines) blocks.push({ type: "code", language: codeLanguage, code: codeLines.join("\n") });
  flushParagraph();
  flushList();
  return blocks;
}

function InlineMarkdown({ text }) {
  const value = String(text || "");
  const parts = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) parts.push({ type: "text", value: value.slice(lastIndex, match.index) });
    const token = match[0];
    const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (token.startsWith("`")) {
      parts.push({ type: "code", value: token.slice(1, -1) });
    } else if (token.startsWith("**")) {
      parts.push({ type: "strong", value: token.slice(2, -2) });
    } else if (link) {
      parts.push({ type: "link", value: link[1], href: link[2] });
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) parts.push({ type: "text", value: value.slice(lastIndex) });

  return parts.map((part, index) => {
    if (part.type === "code") {
      return (
        <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em] text-foreground">
          {part.value}
        </code>
      );
    }
    if (part.type === "strong") return <strong key={index}>{part.value}</strong>;
    if (part.type === "link") {
      return (
        <a key={index} href={part.href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
          {part.value}
        </a>
      );
    }
    return <React.Fragment key={index}>{part.value}</React.Fragment>;
  });
}

function MarkdownBlocks({ text, muted = false }) {
  const blocks = parseMarkdownBlocks(text);
  if (!blocks.length) return null;

  return (
    <div className={cn("space-y-3 text-sm leading-6", muted ? "text-muted-foreground" : "text-foreground/88")}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Heading = block.depth <= 2 ? "h3" : "h4";
          return (
            <Heading key={index} className="mt-4 text-sm font-semibold tracking-normal text-foreground first:mt-0">
              <InlineMarkdown text={block.text} />
            </Heading>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="space-y-1">
              {block.items.map((item, itemIndex) => (
                <li
                  key={`${itemIndex}-${item.text}`}
                  className="grid grid-cols-[1rem,minmax(0,1fr)] gap-2"
                  style={{ marginLeft: `${item.level * 1.1}rem` }}
                >
                  <span className="pt-[0.68rem]">
                    <span className="block size-1.5 rounded-full bg-primary/70" />
                  </span>
                  <span className="min-w-0">
                    <InlineMarkdown text={item.text} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "code") {
          return (
            <pre key={index} className="max-h-80 overflow-auto rounded-md border bg-background p-3 font-mono text-xs leading-5 text-muted-foreground">
              <code>{block.code}</code>
            </pre>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            <InlineMarkdown text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

function runModeLabel(id, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  return copy.runModeLabels?.[id] || RUN_MODES.find((item) => item.id === id)?.label || id;
}

function policyLabel(id, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  return copy.policyLabels?.[id] || POLICY_OPTIONS.find((item) => item.id === id)?.label || id;
}

function statusLabel(status, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  const value = status || "idle";
  return copy.statusLabels?.[value] || value;
}

function buildAgentProfile(agent, workspace) {
  const permissions = normalizePermissionState(agent?.permissions);
  const toolPolicyEntries = Object.entries(permissions.builtInPolicies);
  const allowedToolCount = toolPolicyEntries.filter(([, mode]) => mode === "allow").length;
  const blockedToolCount = toolPolicyEntries.filter(([, mode]) => mode === "block").length;
  const projects = normalizeAgentProjects(agent?.projects, agent?.workspace);
  return [
    "Autohand Squad member profile",
    `Agent ID: ${agent?.id || "unknown"}`,
    agent?.staffId ? `Staff ID: ${agent.staffId}` : "",
    `Name: ${agent?.name || "Autohand agent"}`,
    `Role: ${agent?.role || "Software engineering agent"}`,
    agent?.description ? `Description: ${agent.description}` : "",
    agent?.instructions ? `Operating instructions: ${agent.instructions}` : "",
    workspace ? `Selected repository folder for this run: ${workspace}` : "",
    projects.length ? `Associated repositories/projects:\n${projects.map((project) => `- ${project.label || project.name}: ${project.path}`).join("\n")}` : "",
    `Autohand Skills registry: ${agent?.skillSource || AUTOHAND_SKILLS_REGISTRY_URL}`,
    agent?.id ? `Agent profile map: .autohand/agents/${agent.id}/AGENTS.md` : "",
    agent?.id ? `Agent profile files: .autohand/agents/${agent.id}/profile` : "",
    agent?.id ? `Profile skills install target: .autohand/agents/${agent.id}/skills` : "",
    `Permission mode: ${permissions.permissionMode}`,
    `Built-in CLI tools: ${allowedToolCount} autonomous, ${blockedToolCount} blocked, remaining tools ask first.`,
    permissions.sensitivePaths.length ? `Sensitive path guard entries: ${permissions.sensitivePaths.length}` : "",
    "This process is launched for one Autohand Squad member. Keep memory, sessions, and configuration isolated to that squad member's Autohand home.",
    "Use the agent profile map to decide which profile Markdown files to read; do not assume every profile file must be loaded for every task.",
    "The profile skills are installed from the curated Autohand Skills repository. Activate and use the relevant installed skills when they match the user's request.",
    "When the user sends a message in Autohand Squad, answer as this configured CLI instance and keep all work scoped to the selected folder unless the user explicitly changes it.",
    Array.isArray(agent?.skills) && agent.skills.length ? `Profile skills: ${agent.skills.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function agentLaunchPayload(agent) {
  return {
    id: agent?.id,
    staffId: agent?.staffId,
    name: agent?.name,
    role: agent?.role,
    description: agent?.description,
    instructions: agent?.instructions,
    skillSource: agent?.skillSource || AUTOHAND_SKILLS_REGISTRY_URL,
    skillInstall: agent?.skillInstall,
    skills: normalizeSkillList(agent?.skills),
    projects: normalizeAgentProjects(agent?.projects, agent?.workspace),
    profileFiles: buildAgentProfileFiles(agent),
    profileDocs: agent?.profileDocs,
    permissions: normalizePermissionState(agent?.permissions),
  };
}

function DesktopSidebar({ collapsed, onCollapsedChange, ...props }) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen min-h-screen self-start overflow-visible border-r border-border/70 bg-card/70 backdrop-blur-xl lg:block",
        collapsed && "bg-card/95 backdrop-blur-xl dark:bg-black/95 dark:backdrop-blur-none"
      )}
    >
      {collapsed ? (
        <CollapsedSidebarRail {...props} onExpand={() => onCollapsedChange(false)} />
      ) : (
        <SidebarContent {...props} onCollapse={() => onCollapsedChange(true)} />
      )}
    </aside>
  );
}

function BrandMark({ theme = "dark", className }) {
  const mode = theme === "light" ? "light" : "dark";
  return (
    <img
      src={BRAND_MARKS[mode]}
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 object-contain", className)}
      decoding="async"
    />
  );
}

function CollapsedSidebarRail({
  agents,
  activeAgent,
  navigate,
  route,
  theme,
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  onSettings,
  onAnalytics,
  onExpand,
}) {
  const visibleAgents = agents.filter((agent) => agent?.id && agent?.name);
  const memberId = activeAgent?.id || visibleAgents[0]?.id;
  const isCreatingMember = isCreateMemberRoute(route);
  const isMemberProfile = isMemberProfileRoute(route);

  if (isMemberProfile && activeAgent) {
    return (
      <CollapsedMemberProfileRail
        agent={activeAgent}
        activeSection={memberSectionFromRoute(route)}
        copy={copy}
        navigate={navigate}
        theme={theme}
        onSettings={onSettings}
        onAnalytics={onAnalytics}
        onExpand={onExpand}
      />
    );
  }

  return (
    <div className="flex h-full min-h-screen w-[72px] flex-col items-center bg-card/95 px-2 py-3.5 text-card-foreground dark:bg-black">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-9 rounded-lg hover:bg-transparent"
            onClick={() => navigate(memberChatPath(memberId))}
            aria-label="Open Autohand Squad"
          >
            <BrandMark theme={theme} className="size-7" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Autohand Squad</TooltipContent>
      </Tooltip>

      <div className="mt-4 flex flex-col items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-sm border border-transparent text-muted-foreground hover:border-border/70 hover:bg-accent hover:text-accent-foreground [&_svg:not([class*='size-'])]:size-4"
              onClick={onExpand}
              aria-label="Expand sidebar"
              aria-keyshortcuts="Meta+B Control+B"
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Expand sidebar ({SIDEBAR_SHORTCUT_LABEL})</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-9 rounded-full border border-dashed border-border/80 bg-transparent text-muted-foreground hover:border-primary/70 hover:bg-primary/10 hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5",
                isCreatingMember && "border-primary/80 bg-primary/10 text-foreground"
              )}
              onClick={() => navigate(`${MEMBER_ROUTE_PREFIX}/new`)}
              aria-label={copy.createSquadMember}
            >
              <Plus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copy.createSquadMember}</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="mt-5 min-h-0 w-full flex-1">
        <nav aria-label={copy.mySquadMembers} className="flex flex-col items-center gap-3 pb-4">
          {visibleAgents.map((agent) => {
            const isActive = activeAgent?.id === agent.id && !isCreatingMember;
            return (
              <Tooltip key={agent.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    aria-label={`${agent.name}, ${agent.role || copy.squadMember}`}
                    className={cn(
                      "grid size-9 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      isActive ? "bg-transparent" : "hover:bg-accent"
                    )}
                    onClick={() => navigate(memberChatPath(agent.id))}
                  >
                    <AgentAvatar
                      agent={agent}
                      className={cn(
                        "size-9 border border-transparent",
                        isActive && "border-card ring-2 ring-foreground/85 dark:border-background dark:ring-foreground/90"
                      )}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {agent.name}
                  {agent.role ? `, ${agent.role}` : ""}
                  {" · "}
                  {agentSidebarTime(agent, locale)}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </ScrollArea>

      <div className="-mx-2 mt-auto flex w-[calc(100%+1rem)] justify-center border-t border-border/80 pt-4">
        <AccountMenuButton
          copy={copy}
          onSettings={onSettings}
          onAnalytics={onAnalytics}
          placement="right-start"
          triggerClassName="size-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg:not([class*='size-'])]:size-4"
        />
      </div>
    </div>
  );
}

function CollapsedMemberProfileRail({ agent, activeSection, theme, copy = getLocaleCopy(DEFAULT_LOCALE), navigate, onSettings, onAnalytics, onExpand }) {
  return (
    <div className="flex h-full min-h-screen w-[72px] flex-col items-center bg-card/95 px-2 py-3.5 text-card-foreground dark:bg-black">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-9 rounded-lg hover:bg-transparent"
            onClick={() => navigate(memberChatPath(agent.id))}
            aria-label="Open Autohand Squad"
          >
            <BrandMark theme={theme} className="size-7" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Autohand Squad</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="mt-4 size-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg:not([class*='size-'])]:size-4"
            onClick={() => navigate(memberChatPath(agent.id))}
            aria-label={copy.backToChat}
          >
            <ArrowLeft className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copy.backToChat}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="mt-2 size-7 rounded-sm border border-transparent text-muted-foreground hover:border-border/70 hover:bg-accent hover:text-accent-foreground [&_svg:not([class*='size-'])]:size-4"
            onClick={onExpand}
            aria-label="Expand sidebar"
            aria-keyshortcuts="Meta+B Control+B"
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Expand sidebar ({SIDEBAR_SHORTCUT_LABEL})</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="mt-5 grid size-9 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => navigate(memberProfilePath(agent.id, "home"))}
            aria-label={agent.name || copy.squadMember}
          >
            <AgentAvatar agent={agent} className="size-9 border border-card ring-1 ring-border/90 dark:border-background dark:ring-border" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{agent.name || copy.squadMember}</TooltipContent>
      </Tooltip>

      <nav aria-label={`${agent.name || copy.squadMember} sections`} className="mt-6 flex flex-col items-center gap-2">
        {MEMBER_SECTIONS.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          const label = localizedSectionLabel(item.id, copy);
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "grid size-9 place-items-center rounded-md text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active
                      ? "bg-muted text-foreground dark:bg-[#3a3a3a] dark:text-foreground"
                      : "hover:bg-accent hover:text-accent-foreground"
                  )}
                  onClick={() => navigate(memberProfilePath(agent.id, item.id))}
                >
                  <Icon className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      <div className="-mx-2 mt-auto flex w-[calc(100%+1rem)] justify-center border-t border-border/80 pt-4">
        <AccountMenuButton
          copy={copy}
          onSettings={onSettings}
          onAnalytics={onAnalytics}
          placement="right-start"
          triggerClassName="size-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg:not([class*='size-'])]:size-4"
        />
      </div>
    </div>
  );
}

function SidebarContent({ agents, activeAgent, navigate, route, theme, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE), onSettings, onAnalytics, onCollapse }) {
  const visibleAgents = agents.filter((agent) => agent?.id && agent?.name);
  const memberId = activeAgent?.id || visibleAgents[0]?.id;
  const chatPath = memberChatPath(memberId);
  const isCreatingMember = isCreateMemberRoute(route);
  const isMemberProfile = isMemberProfileRoute(route);

  if (isMemberProfile && activeAgent) {
    return (
      <MemberProfileSidebar
        agent={activeAgent}
        activeSection={memberSectionFromRoute(route)}
        copy={copy}
        navigate={navigate}
        theme={theme}
        onSettings={onSettings}
        onAnalytics={onAnalytics}
        onCollapse={onCollapse}
      />
    );
  }

  return (
    <div className="flex h-full min-h-screen flex-col bg-card/70">
      <div className="flex h-14 items-center gap-2 px-4">
        <Button variant="ghost" className="h-10 justify-start gap-2 px-1 hover:bg-transparent" onClick={() => navigate(chatPath)}>
          <BrandMark theme={theme} className="size-9" />
          <span className="text-base font-bold">Autohand Squad</span>
        </Button>
        <Badge variant="secondary" className="ml-1 rounded-sm bg-primary/15 px-1.5 text-[10px] text-primary">Beta</Badge>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-2 pb-4 pt-2">
        <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {copy.mySquadMembers} ({formatLocalizedNumber(visibleAgents.length, locale)})
          </span>
          {onCollapse ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onCollapse}
                  aria-label="Collapse sidebar"
                  aria-keyshortcuts="Meta+B Control+B"
                >
                  <PanelLeftClose />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Collapse sidebar ({SIDEBAR_SHORTCUT_LABEL})</TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        <Button
          variant="outline"
          className={cn(
            "h-11 w-full justify-center rounded-md border-dashed bg-transparent text-muted-foreground hover:bg-muted/45 hover:text-foreground",
            isCreatingMember && "border-primary/70 bg-primary/10 text-foreground"
          )}
          onClick={() => navigate(`${MEMBER_ROUTE_PREFIX}/new`)}
        >
          <Plus data-icon="inline-start" />
          {copy.createSquadMember}
        </Button>

        <ScrollArea className="min-h-0 flex-1 pr-1">
          <div className="flex flex-col gap-1.5">
            {visibleAgents.map((agent) => {
              const isActive = activeAgent?.id === agent.id && !isCreatingMember;
              return (
                <button
                  key={agent.id}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "grid min-h-[66px] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                    isActive ? "bg-muted/80 text-foreground" : "text-foreground/88 hover:bg-muted/55"
                  )}
                  onClick={() => navigate(memberChatPath(agent.id))}
                >
                  <AgentAvatar agent={agent} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{agent.name}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{agentSidebarPreview(agent)}</span>
                  </span>
                  <time className="self-start pt-1 text-[11px] font-semibold text-muted-foreground/75">
                    {agentSidebarTime(agent, locale)}
                  </time>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      <SidebarAccountFooter copy={copy} onSettings={onSettings} onAnalytics={onAnalytics} />
    </div>
  );
}

function MemberProfileSidebar({ agent, activeSection, theme, copy = getLocaleCopy(DEFAULT_LOCALE), navigate, onSettings, onAnalytics, onCollapse }) {
  return (
    <div className="flex h-full min-h-screen flex-col bg-background">
      <div className="flex h-14 items-center gap-2 px-4">
        <Button
          variant="ghost"
          className="h-10 min-w-0 justify-start gap-2 px-1 hover:bg-transparent"
          onClick={() => navigate(memberChatPath(agent.id))}
          aria-label="Open Autohand Squad"
        >
          <BrandMark theme={theme} className="size-9" />
          <span className="truncate text-base font-bold">Autohand Squad</span>
        </Button>
        <Badge variant="secondary" className="ml-1 rounded-sm bg-primary/15 px-1.5 text-[10px] text-primary">Beta</Badge>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-2 pb-4 pt-2">
        <div className="mb-4 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            className="h-8 w-fit justify-start gap-3 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => navigate(memberChatPath(agent.id))}
          >
            <ArrowLeft data-icon="inline-start" />
            {copy.backToChat}
          </Button>
          {onCollapse ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onCollapse}
                  aria-label="Collapse sidebar"
                  aria-keyshortcuts="Meta+B Control+B"
                >
                  <PanelLeftClose />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Collapse sidebar ({SIDEBAR_SHORTCUT_LABEL})</TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        <div className="mb-8 flex items-center gap-3 px-1">
          <AgentAvatar agent={agent} className="size-7 border-0" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{agent.name}</div>
            {agent.role ? <div className="sr-only">{agent.role}</div> : null}
          </div>
        </div>

        <nav aria-label={`${agent.name} sections`} className="flex flex-col gap-1">
          {MEMBER_SECTIONS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <NavButton
                key={item.id}
                active={active}
                onClick={() => navigate(memberProfilePath(agent.id, item.id))}
              >
                <Icon data-icon="inline-start" />
                {localizedSectionLabel(item.id, copy)}
              </NavButton>
            );
          })}
        </nav>
      </div>

      <SidebarAccountFooter copy={copy} onSettings={onSettings} onAnalytics={onAnalytics} />
    </div>
  );
}

function SidebarAccountFooter({ copy = getLocaleCopy(DEFAULT_LOCALE), onSettings, onAnalytics }) {
  return (
    <div className="border-t p-4">
      <Button variant="outline" className="h-9 w-full justify-center rounded-full border-border/70 bg-transparent" onClick={onSettings}>
        <CircleDot className="text-chart-3" data-icon="inline-start" />
        {copy.restartToUpdate}
      </Button>
      <div className="mt-3 flex items-center gap-3 rounded-md px-1 py-2">
        <span className="grid size-9 place-items-center rounded-md bg-muted text-sm font-semibold">{ACCOUNT_PROFILE.initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{ACCOUNT_PROFILE.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{copy.proTrial}</span>
        </span>
        <AccountMenuButton copy={copy} onSettings={onSettings} onAnalytics={onAnalytics} />
      </div>
    </div>
  );
}

function AccountMenuButton({
  copy = getLocaleCopy(DEFAULT_LOCALE),
  onSettings,
  onAnalytics,
  placement = "top-end",
  triggerClassName,
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const menuPosition =
    {
      "bottom-end": "right-0 top-11",
      "right-start": "bottom-0 left-10",
      "top-end": "bottom-10 right-0",
    }[placement] || "bottom-10 right-0";

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsidePress(event) {
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function choose(action) {
    setOpen(false);
    action?.();
  }

  return (
    <div ref={menuRef} className="relative shrink-0">
      <Button
        variant="ghost"
        size="icon-sm"
        className={triggerClassName}
        onClick={() => setOpen((current) => !current)}
        aria-label={copy.openAccountMenu}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Settings />
      </Button>
      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute z-50 w-64 rounded-lg border border-border/85 bg-popover p-1.5 text-popover-foreground shadow-2xl shadow-black/35",
            menuPosition
          )}
        >
          <div className="px-2.5 py-2.5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase text-muted-foreground">{copy.account}</span>
              <Badge variant="outline" className="rounded-sm border-primary/40 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
                {copy.loggedIn}
              </Badge>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 place-items-center rounded-md bg-muted text-sm font-semibold">
                {ACCOUNT_PROFILE.initials}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{ACCOUNT_PROFILE.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{copy.proTrial}</span>
              </span>
            </div>
          </div>
          <div className="my-1 border-t border-border/70" />
          <AccountMenuItem icon={Settings} label={copy.settings} onClick={() => choose(onSettings)} hasChevron />
          <AccountMenuItem icon={Gauge} label={copy.analytics} onClick={() => choose(onAnalytics)} hasChevron />
          <div className="my-1 border-t border-border/70" />
          <AccountMenuItem icon={LogOut} label={copy.signOut} onClick={() => choose()} />
        </div>
      ) : null}
    </div>
  );
}

function AccountMenuItem({ icon: Icon, label, onClick, hasChevron = false }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
      onClick={onClick}
    >
      <Icon className="size-4" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hasChevron ? <ChevronRight className="size-4 text-muted-foreground" /> : null}
    </button>
  );
}

function NavButton({ active, onClick, children }) {
  return (
    <Button
      variant="ghost"
      aria-current={active ? "page" : undefined}
      className={cn(
        "h-9 w-full justify-start rounded-md px-5 text-sm font-medium",
        active
          ? "bg-accent/70 text-foreground hover:bg-accent/80 focus-visible:ring-primary/20 dark:bg-[#3a3a3a] dark:hover:bg-[#3a3a3a]"
          : "text-muted-foreground hover:bg-accent/35 hover:text-foreground"
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function RuntimeCompact({ runtime }) {
  if (!runtime) {
    return (
      <Card className="gap-3 rounded-lg py-4">
        <CardContent className="flex items-center gap-3 px-4">
          <Skeleton className="size-9 rounded-md" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-3 rounded-lg border-border/80 bg-muted/35 py-4 shadow-none">
      <CardContent className="flex items-center gap-3 px-4">
        <span className={cn("size-2.5 rounded-full", runtime.available ? "bg-primary shadow-[0_0_24px_var(--primary)]" : "bg-destructive")} />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{runtime.available ? "Autohand wired" : "Autohand missing"}</div>
          <div className="truncate text-xs text-muted-foreground">{runtime.version || runtime.autohandPath || "checking runtime"}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function MobileTopbar({ activeAgent, theme, copy = getLocaleCopy(DEFAULT_LOCALE), onMenu, onSettings, onAnalytics }) {
  return (
    <div className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/90 px-3 backdrop-blur lg:hidden">
      <Button variant="ghost" size="icon" onClick={onMenu} aria-label={copy.sidebar}>
        <Menu />
      </Button>
      <div className="min-w-0 flex-1 px-3">
        <div className="flex items-center justify-center gap-2 text-sm font-extrabold">
          <BrandMark theme={theme} className="size-8" />
          <span className="truncate">Autohand Squad</span>
        </div>
        <div className="truncate text-center text-xs text-muted-foreground">
          {activeAgent?.name || copy.squadMember} / {activeAgent ? localizedRole(activeAgent, copy) : "CLI console"}
        </div>
      </div>
      <AccountMenuButton copy={copy} onSettings={onSettings} onAnalytics={onAnalytics} placement="bottom-end" />
    </div>
  );
}

function mentionTokenForAgent(agent) {
  return String(agent?.name || "")
    .trim()
    .replace(/\s+/g, "");
}

function currentMentionQuery(text, caret = String(text || "").length) {
  const value = String(text || "");
  const cursor = Math.max(0, Math.min(Number.isFinite(caret) ? caret : value.length, value.length));
  const tokenStart = value.lastIndexOf("@", Math.max(0, cursor - 1));
  if (tokenStart < 0) return null;

  const previous = value[tokenStart - 1] || "";
  if (previous && !/\s/.test(previous)) return null;

  let tokenEnd = tokenStart + 1;
  while (tokenEnd < value.length && /[A-Za-z0-9._/-]/.test(value[tokenEnd])) {
    tokenEnd += 1;
  }
  if (cursor > tokenEnd) return null;

  const query = value.slice(tokenStart + 1, tokenEnd);
  if (query.length > 120) return null;
  return {
    query,
    start: tokenStart,
    end: tokenEnd,
  };
}

function insertMentionText(text, item, mention = currentMentionQuery(text)) {
  if (!mention) {
    const nextText = `${text}@${item.value} `;
    return { text: nextText, caret: nextText.length };
  }

  const prefix = text.slice(0, mention.start);
  const suffix = text.slice(mention.end);
  const spacer = suffix && /^\s/.test(suffix) ? "" : " ";
  const inserted = `${prefix}@${item.value}${spacer}`;
  return {
    text: `${inserted}${suffix}`,
    caret: inserted.length,
  };
}

function mentionedSquadMembers(text, agents = [], activeAgentId = "") {
  const tokens = new Set(
    Array.from(String(text || "").matchAll(/@([A-Za-z0-9._/-]+)/g))
      .map((match) => match[1].toLowerCase())
      .filter(Boolean)
  );
  if (!tokens.size) return [];
  return agents.filter((agent) => {
    if (agent.id === activeAgentId || agent.status !== "online") return false;
    const names = [
      agent.id,
      agent.employeeId,
      agent.staffId,
      mentionTokenForAgent(agent),
      String(agent.name || ""),
    ].map((value) => String(value || "").toLowerCase());
    return names.some((name) => tokens.has(name));
  });
}

function mentionedFilePaths(text) {
  return Array.from(String(text || "").matchAll(/@([A-Za-z0-9._/-]*[/\\.][A-Za-z0-9._/-]+)/g))
    .map((match) => match[1])
    .filter(Boolean);
}

function formatMentionLookupError(error) {
  const message = String(error?.message || "");
  if (message.includes("returned the app shell") || message.includes("/api/workspace-files")) {
    return "Restart app for files";
  }
  if (message.includes("workspace")) return "Choose a workspace";
  return "File search unavailable";
}

function AgentAvatar({ agent, large = false, className }) {
  const initial = agent?.name?.slice(0, 1).toUpperCase() || "S";
  return (
    <Avatar className={cn("rounded-full border border-border/70 bg-muted", large ? "size-24" : "size-8", className)}>
      {agent?.avatar ? <AvatarImage src={agent.avatar} alt={agent.name || "Squad member"} className="object-cover" /> : null}
      <AvatarFallback className="rounded-full bg-primary/12 text-primary">
        <span className={cn("font-extrabold", large ? "text-2xl" : "text-sm")}>{initial}</span>
      </AvatarFallback>
    </Avatar>
  );
}

function Conversation({
  agent,
  agents = [],
  messages,
  runtime,
  workspaces,
  runs,
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  onStart,
  onChat,
  onNewConversation,
  openTerminal,
  navigate,
  taskPanelOpen,
  setTaskPanelOpen,
  tasks,
  automations,
  setAutomations,
  runAutomation,
  requestedWorkspace,
  handoffRetryMode = DEFAULT_HANDOFF_RETRY_MODE,
  onCreateHandoff,
  onCancelHandoff,
  onFailHandoff,
  onRetryHandoff,
}) {
  const defaultLaunch = agent.launch || { mode: "prompt", policy: "restricted", model: "", dryRun: false };
  const defaultWorkspace =
    requestedWorkspace && !isBlockedWorkspace(requestedWorkspace, runtime)
      ? requestedWorkspace
      : getAgentWorkspace(agent, runtime, workspaces);
  const [prompt, setPrompt] = useState("");
  const [workspace, setWorkspace] = useState(defaultWorkspace);
  const [mode, setMode] = useState(defaultLaunch.mode);
  const [policy, setPolicy] = useState(defaultLaunch.policy);
  const [model, setModel] = useState(defaultLaunch.model || "");
  const [dryRun, setDryRun] = useState(defaultLaunch.dryRun);
  const [panelTab, setPanelTab] = useState("runs");
  const [profilePreviewOpen, setProfilePreviewOpen] = useState(false);
  const [automationFormOpen, setAutomationFormOpen] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [runStarting, setRunStarting] = useState(false);
  const promptRef = useRef(null);
  const messagesEndRef = useRef(null);
  const [mentionState, setMentionState] = useState(null);
  const [mentionFiles, setMentionFiles] = useState([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const activeMode = RUN_MODES.find((item) => item.id === mode) || RUN_MODES[0];
  const latestRun = runs[0];
  const workspaceChoices = workspaceOptions(workspaces, workspace, runtime);
  const blockedWorkspace = isBlockedWorkspace(workspace, runtime);
  const runningCount = runs.filter((run) => run.status === "running").length;
  const mentionQuery = mentionState?.query || "";
  const normalizedMentionQuery = mentionQuery.toLowerCase();
  const isFileMentionQuery =
    ["file", "files"].includes(normalizedMentionQuery) ||
    mentionQuery.includes("/") ||
    mentionQuery.includes(".") ||
    mentionQuery.length >= 3;
  const fileMentionQuery = ["file", "files"].includes(normalizedMentionQuery) ? "" : mentionQuery;
  const workspaceFileMentionsAvailable = runtime?.features?.workspaceFileMentions === true;
  const memberMentionItems = useMemo(() => {
    const query = mentionQuery.toLowerCase();
    return agents
      .filter((item) => item.id !== agent.id && item.status === "online")
      .filter((item) => {
        const haystack = `${item.name || ""} ${item.role || ""} ${item.employeeType || ""}`.toLowerCase();
        return !query || haystack.includes(query);
      })
      .map((item) => ({
        type: "agent",
        value: mentionTokenForAgent(item),
        title: item.name,
        detail: localizedRole(item, copy),
        agent: item,
      }));
  }, [agent.id, agents, copy, mentionQuery]);
  const fileMentionItems = useMemo(
    () =>
      mentionFiles.map((file) => ({
        type: "file",
        value: file.path,
        title: file.path,
        detail: file.detail || "Workspace file",
      })),
    [mentionFiles]
  );
  const mentionItems = useMemo(
    () => [...memberMentionItems, ...fileMentionItems].slice(0, 6),
    [fileMentionItems, memberMentionItems]
  );
  const mentionOpen = Boolean(mentionState);
  const visibleMessages = useMemo(
    () => (messages.length ? messages : initialMessages(agent.name)),
    [agent.name, messages]
  );
  const latestVisibleMessage = visibleMessages[visibleMessages.length - 1];
  useEffect(() => {
    const normalizedWorkspace = normalizeSquadWorkspacePath(workspace, runtime);
    if (normalizedWorkspace && normalizedWorkspace !== workspace) {
      setWorkspace(normalizedWorkspace);
      return;
    }
    if (!workspace || isBlockedWorkspace(workspace, runtime)) {
      setWorkspace(defaultWorkspace);
    }
  }, [agent.id, defaultWorkspace, runtime, workspace]);

  useEffect(() => {
    if (!mentionOpen || !isFileMentionQuery || blockedWorkspace || !workspace) {
      setMentionFiles([]);
      setMentionLoading(false);
      setMentionError("");
      return undefined;
    }

    if (!workspaceFileMentionsAvailable) {
      setMentionFiles([]);
      setMentionLoading(false);
      setMentionError("Restart app for files");
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMentionLoading(true);
      setMentionError("");
      try {
        const params = new URLSearchParams({ workspace, q: fileMentionQuery });
        const files = await api(`/api/workspace-files?${params.toString()}`, { signal: controller.signal });
        if (!controller.signal.aborted) setMentionFiles(files);
      } catch (error) {
        if (!controller.signal.aborted) {
          setMentionFiles([]);
          setMentionError(formatMentionLookupError(error));
        }
      } finally {
        if (!controller.signal.aborted) setMentionLoading(false);
      }
    }, 60);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [blockedWorkspace, fileMentionQuery, isFileMentionQuery, mentionOpen, workspace, workspaceFileMentionsAvailable]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery, mentionItems.length]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    agent.id,
    visibleMessages.length,
    latestVisibleMessage?.id,
    latestVisibleMessage?.body,
    latestVisibleMessage?.status,
    latestVisibleMessage?.time,
  ]);

  function updatePrompt(value, caret = value.length) {
    setPrompt(value);
    setMentionState(currentMentionQuery(value, caret));
  }

  function syncMentionFromTarget(target) {
    updatePrompt(target.value, target.selectionStart ?? target.value.length);
  }

  function selectMentionItem(item) {
    const nextPrompt = insertMentionText(prompt, item, mentionState);
    setPrompt(nextPrompt.text);
    setMentionState(null);
    window.requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(nextPrompt.caret, nextPrompt.caret);
    });
  }

  function handlePromptKeyDown(event) {
    const wantsPlainEnter =
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.nativeEvent?.isComposing;

    if (!mentionOpen) {
      if (wantsPlainEnter) {
        event.preventDefault();
        void submit(event);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setMentionState(null);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMentionIndex((current) => (mentionItems.length ? (current + 1) % mentionItems.length : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMentionIndex((current) => (mentionItems.length ? (current - 1 + mentionItems.length) % mentionItems.length : 0));
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && mentionItems[mentionIndex]) {
      event.preventDefault();
      selectMentionItem(mentionItems[mentionIndex]);
      return;
    }

    if (wantsPlainEnter) {
      event.preventDefault();
      void submit(event);
    }
  }

  function createMentionHandoff(chatPrompt) {
    const [targetAgent] = mentionedSquadMembers(chatPrompt, agents, agent.id);
    if (!targetAgent || !onCreateHandoff) return;

    const sourceTask = tasks.find((task) => !["completed", "cancelled"].includes(task.status)) || tasks[0] || null;
    const fileMentions = mentionedFilePaths(chatPrompt);
    onCreateHandoff(
      {
        type: "chat-mention",
        task: sourceTask,
        sourceAgentId: agent.id,
      },
      {
        targetAgentId: targetAgent.id,
        title: `Chat handoff from ${agent.name}`,
        reason: `Mentioned in chat: @${mentionTokenForAgent(targetAgent)}`,
        requiredContext: chatPrompt,
        expectedOutput: "Inspect the preserved context, continue the same parent task, and report evidence.",
        sourceEvidence: fileMentions.length ? fileMentions.map((file) => `File: ${file}`).join("\n") : workspaceLabel(workspace, workspaces),
      }
    );
  }

  function submit(event) {
    event.preventDefault();
    if (!prompt.trim() || blockedWorkspace || chatSending) return;
    const submittedPrompt = prompt;
    setPrompt("");
    setMentionState(null);
    setChatSending(true);
    try {
      createMentionHandoff(submittedPrompt);
      const chatPromise = Promise.resolve(onChat(agent.id, { prompt: submittedPrompt, workspace, policy, model }));
      window.setTimeout(() => setChatSending(false), 180);
      void chatPromise.finally(() => setChatSending(false));
    } catch {
      setPrompt(submittedPrompt);
      setChatSending(false);
    }
  }

  async function startRunFromComposer() {
    if (!prompt.trim() || blockedWorkspace || !runtime?.available) return;
    setRunStarting(true);
    try {
      await onStart(agent.id, {
        prompt,
        workspace,
        mode,
        modeLabel: runModeLabel(activeMode.id, copy),
        policy,
        model,
        dryRun,
      });
      setPrompt("");
      setMentionState(null);
    } finally {
      setRunStarting(false);
    }
  }

  function openPanel(tab) {
    setPanelTab(tab);
    setTaskPanelOpen(true);
  }

  function saveAutomation(draft) {
    const saved = buildAutomationFromDraft(draft, null, agent, defaultWorkspace);
    setAutomations((current) => [saved, ...current]);
    setAutomationFormOpen(false);
  }

  function startFreshChat() {
    setPrompt("");
    setMentionState(null);
    onNewConversation?.(agent.id);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-[560px] flex-col bg-background/75 lg:h-screen lg:min-h-screen">
      <header className="flex min-h-16 flex-col gap-3 border-b bg-background/92 px-4 py-3 backdrop-blur-xl sm:px-6 xl:flex-row xl:items-center xl:justify-between xl:gap-5">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar agent={agent} />
          <div className="min-w-0">
            <button
              type="button"
              className="flex min-w-0 items-center gap-2 rounded-md text-left outline-none transition-colors hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40"
              onClick={() => setProfilePreviewOpen(true)}
            >
              <span className="truncate text-base font-semibold">{agent.name}</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">
                {localizedRole(agent, copy)}
              </Badge>
              <span className="truncate">{workspaceLabel(workspace, workspaces)}</span>
              <span className={cn("size-1.5 rounded-full", runtime?.available ? "bg-primary" : "bg-destructive")} />
              <span>{runtime?.available ? copy.localCliReady : copy.autohandMissing}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={startFreshChat}>
            <Plus data-icon="inline-start" />
            {copy.task}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAutomationFormOpen(true)}>
            <Plus data-icon="inline-start" />
            {copy.automation}
          </Button>
          <span className="mx-1 hidden h-7 w-px bg-border sm:block" />
          <Button variant="ghost" size="sm" onClick={() => openPanel("tasks")}>
            <History data-icon="inline-start" />
            {copy.taskList}
          </Button>
          <Button variant={runningCount ? "secondary" : "ghost"} size="sm" onClick={() => openPanel("runs")}>
            <CircleDot data-icon="inline-start" className={cn(runningCount && "text-primary")} />
            {copy.current}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 pb-40 sm:px-6 lg:py-8">
            <div className="flex justify-center">
              <button
                type="button"
                className="max-w-4xl rounded-2xl bg-muted/75 px-5 py-3 text-left text-sm leading-6 text-foreground/90 transition-colors hover:bg-muted"
                onClick={() => setPrompt(copy.qaPrompt)}
              >
                {copy.qaPrompt}
              </button>
            </div>

            <SquadStatusRow
              agent={agent}
              activeMode={activeMode}
              latestRun={latestRun}
              runtime={runtime}
              workspace={workspace}
              workspaces={workspaces}
              copy={copy}
            />

            <div className="flex flex-col gap-4">
              {visibleMessages.map((message) => (
                <SquadMessage key={message.id} agent={agent} message={localizedMessage(message, agent, copy)} copy={copy} />
              ))}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
          </div>
        </ScrollArea>

        <form className="border-t bg-background/94 px-3 py-3 backdrop-blur-xl sm:px-5" onSubmit={submit}>
          <div className="mx-auto max-w-5xl rounded-lg border bg-card/95 p-3 shadow-2xl shadow-black/30">
            <div className="relative">
              {mentionOpen ? (
                <MentionPicker
                  items={mentionItems}
                  loading={mentionLoading}
                  error={mentionError}
                  selectedIndex={mentionIndex}
                  onSelect={selectMentionItem}
                />
              ) : null}
              <Textarea
                ref={promptRef}
                value={prompt}
                onChange={(event) => syncMentionFromTarget(event.target)}
                onClick={(event) => syncMentionFromTarget(event.currentTarget)}
                onKeyDown={handlePromptKeyDown}
                onKeyUp={(event) => {
                  if (mentionOpen && ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"].includes(event.key)) return;
                  syncMentionFromTarget(event.currentTarget);
                }}
                onSelect={(event) => syncMentionFromTarget(event.currentTarget)}
                placeholder={formatCopy(copy.talkToPlaceholder, { name: agent.name })}
                className="min-h-20 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="mt-3 flex flex-col gap-3 border-t pt-3 lg:flex-row lg:items-center">
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_230px_150px_minmax(120px,0.6fr)]">
                <Select value={blockedWorkspace ? undefined : workspace} onValueChange={setWorkspace} disabled={!workspaceChoices.length}>
                  <SelectTrigger className="h-9 w-full">
                    <FolderGit2 className="size-4 text-muted-foreground" />
                    <SelectValue placeholder={copy.selectWorkspace} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-[420px]">
                    <SelectGroup>
                      <SelectLabel>{copy.localFolders}</SelectLabel>
                      {workspaceChoices.map((item) => (
                        <SelectItem key={item.path} value={item.path}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(value) => value && setMode(value)}
                  variant="outline"
                  className="grid w-full grid-cols-3 gap-1"
                  spacing={1}
                >
                  {RUN_MODES.map((item) => (
                    <ToggleGroupItem key={item.id} value={item.id} className="h-9 px-2 text-xs">
                      {runModeLabel(item.id, copy)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>

                <Select value={policy} onValueChange={setPolicy}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{copy.policy}</SelectLabel>
                      {POLICY_OPTIONS.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {policyLabel(item.id, copy)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>

                <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder={copy.model} className="h-9" />
              </div>

              <div className="flex items-center justify-between gap-2 lg:justify-end">
                <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs text-muted-foreground">
                  <Switch checked={dryRun} onCheckedChange={setDryRun} />
                  {copy.dryRun}
                </label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!prompt.trim() || blockedWorkspace}
                      onClick={() => openTerminal({ ...agent, workspace }, prompt)}
                      aria-label={copy.openInTerminal}
                    >
                      <TerminalSquare />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copy.openInTerminal}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!prompt.trim() || !runtime?.available || blockedWorkspace || runStarting}
                      onClick={startRunFromComposer}
                      aria-label={copy.runWithAutohand}
                    >
                      {runStarting || !runtime ? <Spinner /> : <Play />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copy.runWithAutohand}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="submit" size="icon" disabled={!prompt.trim() || chatSending || blockedWorkspace} aria-label={copy.sendChatMessage}>
                      {chatSending ? <Spinner /> : <Send />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copy.sendChatMessage}</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="mt-2 truncate text-[11px] text-muted-foreground">
              {copy.chatRunHint} autohand --path {workspace || "choose-workspace"} --config .autohand/agents/{agent.id}/config.json {activeMode.detail}
            </div>
          </div>
        </form>
      </div>

      <Sheet open={taskPanelOpen} onOpenChange={setTaskPanelOpen}>
        <SheetContent closeLabel={copy.close} className="w-full border-border/80 p-0 sm:max-w-xl">
          <TaskPanel
            agents={agents}
            activeAgent={agent}
            tasks={tasks}
            runs={runs}
            automations={automations}
            setAutomations={setAutomations}
            runAutomation={runAutomation}
            activeTab={panelTab}
            setActiveTab={setPanelTab}
            copy={copy}
            handoffRetryMode={handoffRetryMode}
            onCreateHandoff={onCreateHandoff}
            onCancelHandoff={onCancelHandoff}
            onFailHandoff={onFailHandoff}
            onRetryHandoff={onRetryHandoff}
          />
        </SheetContent>
      </Sheet>

      <AutomationFormDialog
        agent={agent}
        automation={null}
        defaultWorkspace={defaultWorkspace}
        runtime={runtime}
        workspaces={workspaces}
        open={automationFormOpen}
        onOpenChange={setAutomationFormOpen}
        onSave={saveAutomation}
      />

      <AgentProfilePreviewDialog
        agent={agent}
        tasks={tasks}
        automations={automations}
        open={profilePreviewOpen}
        onOpenChange={setProfilePreviewOpen}
        locale={locale}
        copy={copy}
        onViewDetails={() => {
          setProfilePreviewOpen(false);
          navigate(memberProfilePath(agent.id, "home"));
        }}
      />
    </div>
  );
}

function MentionPicker({ items = [], loading = false, error = "", selectedIndex = 0, onSelect }) {
  return (
    <div className="absolute bottom-full left-0 z-40 mb-1 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-md border bg-popover shadow-xl shadow-black/25">
      <div className="flex max-h-52 flex-col overflow-y-auto p-1">
        {items.map((item, index) => {
          const Icon = item.type === "agent" ? UserRound : FileCode2;
          return (
            <button
              key={`${item.type}-${item.value}`}
              type="button"
              className={cn(
                "flex h-8 items-center gap-2 rounded-sm px-2 text-left transition-colors",
                index === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/70"
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect?.(item);
              }}
            >
              <Icon className="size-3 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 items-baseline gap-2 leading-none">
                <span className="truncate text-[13px] font-medium leading-none">@{item.title}</span>
                <span className="hidden min-w-0 truncate text-[11px] leading-none text-muted-foreground sm:block">
                  {item.detail}
                </span>
              </span>
              {item.type === "agent" ? (
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="online" />
              ) : null}
            </button>
          );
        })}
        {loading ? <div className="flex h-8 items-center px-2 text-[11px] text-muted-foreground">Loading files...</div> : null}
        {!loading && !items.length ? (
          <div className="flex h-8 items-center px-2 text-[11px] text-muted-foreground">{error || "No matching squad members or files."}</div>
        ) : null}
      </div>
    </div>
  );
}

function SquadStatusRow({ agent, activeMode, latestRun, runtime, workspace, workspaces, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const latestStatus = latestRun?.status || "idle";
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(20rem,1fr)_minmax(360px,0.72fr)] lg:items-start">
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="size-4" />
          <span>{copy.deepThinking}</span>
          <ChevronRight className="size-3" />
        </div>
        <p className="max-w-3xl text-base leading-7 text-foreground/88">
          {localizedAgentInstructions(agent, copy)}
        </p>
      </div>
      <div className="grid min-w-0 grid-cols-3 gap-2 rounded-lg border bg-card/60 p-2 text-xs">
        <Metric label={copy.mode} value={runModeLabel(activeMode.id, copy)} />
        <Metric label={copy.latest} value={statusLabel(latestStatus, copy)} />
        <Metric label={copy.workspace} value={workspaceLabel(workspace, workspaces)} />
      </div>
      {!runtime?.available ? (
        <Alert variant="destructive" className="lg:col-span-2">
          <AlertTriangle />
          <AlertTitle>{copy.autohandCliMissing}</AlertTitle>
          <AlertDescription>{copy.autohandCliMissingDescription}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function SquadMessage({ agent, message, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const isUser = message.role === "user";
  if (!isUser) return <AgentResponseMessage agent={agent} message={message} />;

  return (
    <article className="flex justify-end gap-3">
      <div className="max-w-3xl rounded-lg border border-primary/35 bg-primary/10 px-4 py-3 text-foreground">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{copy.you}</span>
          <time>{message.time}</time>
        </div>
        <MarkdownBlocks text={message.body} />
      </div>
    </article>
  );
}

function AgentResponseMessage({ agent, message }) {
  const view = buildAgentResponseView(message);
  const isLoading = message.status === "loading" || String(message.body || "").trim() === `${agent.name} is thinking...`;
  const hasTrace = view.orderedEvents.length;
  const hasRawOutput = Boolean(view.raw.stdout || view.raw.stderr);

  return (
    <article className="grid grid-cols-[auto,minmax(0,1fr)] gap-3">
      <AgentAvatar agent={agent} />
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{agent.name}</span>
          <time>{message.time}</time>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/45" />
          <span>Agent transcript</span>
          {view.toolCalls.length ? <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">{view.toolCalls.length} tools</Badge> : null}
          {view.thoughts.length ? <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">{view.thoughts.length} notes</Badge> : null}
        </div>

        {isLoading ? (
          <div className="flex max-w-xl items-center gap-3 py-2 text-sm text-muted-foreground">
            <Spinner />
            <span>Preparing response...</span>
          </div>
        ) : null}

        {!isLoading && hasTrace ? (
          <AgentWorkTrace view={view} />
        ) : null}

        {!isLoading && view.answer ? (
          <div className={cn("max-w-4xl", hasTrace && "mt-4 border-t pt-4")}>
            <MarkdownBlocks text={view.answer} />
          </div>
        ) : null}

        {!isLoading && hasRawOutput ? <RawTraceBlock raw={view.raw} /> : null}
      </div>
    </article>
  );
}

function AgentWorkTrace({ view }) {
  return (
    <div className="mt-2 space-y-3 border-l border-border/80 pl-4">
      {view.orderedEvents.map((event, index) => (
        <WorkTraceEvent key={`${event.type}-${index}-${event.title || event.content || event.call?.name || ""}`} event={event} index={index} />
      ))}
    </div>
  );
}

function WorkTraceEvent({ event, index }) {
  if (event.type === "step") {
    return <StepTrace steps={[{ index: event.index || index + 1, title: event.title }]} compact />;
  }

  if (event.type === "thought") {
    return <ThoughtTrace thoughts={[event]} compact />;
  }

  if (event.type === "tool_call") {
    return <ToolCallTrace toolCalls={[event.call]} toolResults={event.result ? [event.result] : []} />;
  }

  if (event.type === "assistant_event") {
    return <AssistantEventTrace events={[event]} compact />;
  }

  return null;
}

function StepTrace({ steps, compact = false }) {
  return (
    <div className="space-y-2">
      {steps.map((step, index) => (
        <div key={`${step.index || index}-${step.title}`} className="grid grid-cols-[1.75rem,minmax(0,1fr)] gap-3">
          <div className="flex size-7 items-center justify-center rounded-md border bg-background font-mono text-xs text-muted-foreground">
            {step.index || index + 1}
          </div>
          <div className={cn("min-w-0 text-sm text-foreground/88", compact ? "py-1.5" : "rounded-md border bg-background/70 px-3 py-2")}>
            {step.title}
          </div>
        </div>
      ))}
    </div>
  );
}

function ThoughtTrace({ thoughts, compact = false }) {
  return (
    <div className="space-y-2">
      {thoughts.map((item, index) => (
        <div key={`${index}-${item.thought.slice(0, 24)}`} className={cn(compact ? "py-1.5" : "rounded-md border bg-background/70 p-3")}>
          {item.thought ? (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">Thought</div>
              <MarkdownBlocks text={item.thought} muted />
            </div>
          ) : null}
          {item.reflection ? (
            <div className={cn(item.thought && "mt-3 border-t pt-3")}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">Reflection</div>
              <MarkdownBlocks text={item.reflection} muted />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ToolCallTrace({ toolCalls, toolResults }) {
  return (
    <div className="space-y-2">
      {toolCalls.map((call, index) => {
        const result = toolResults.find((item) => (call.id && item.id === call.id) || (!call.id && item.name === call.name));
        const args = stringifyTraceValue(call.args);
        return (
          <div key={`${call.id || index}-${call.name}`} className="overflow-hidden rounded-md border bg-background/70">
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
              <Hammer className="size-4 text-primary" />
              <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{call.name}</code>
              {call.timestamp ? <time className="ml-auto">{formatShortTime(call.timestamp)}</time> : null}
            </div>
            {args ? (
              <div className="border-b px-3 py-2">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">Arguments</div>
                <pre className="max-h-52 overflow-auto rounded-md bg-muted/35 p-3 font-mono text-xs leading-5 text-muted-foreground">
                  <code>{args}</code>
                </pre>
              </div>
            ) : null}
            {result ? (
              <div className="px-3 py-2">
                <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
                  <CheckCircle2 className="size-3.5 text-primary" />
                  Result
                </div>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted/35 p-3 font-mono text-xs leading-5 text-muted-foreground">
                  <code>{result.content}</code>
                </pre>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function AssistantEventTrace({ events, compact = false }) {
  return (
    <div className="space-y-2">
      {events.map((event, index) => (
        <div key={`${index}-${event.content.slice(0, 24)}`} className={cn(compact ? "py-1.5" : "rounded-md border bg-background/70 p-3")}>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
            <Activity className="size-3.5" />
            Assistant event
            {event.timestamp ? <time className="ml-auto normal-case">{formatShortTime(event.timestamp)}</time> : null}
          </div>
          <MarkdownBlocks text={event.content} muted />
        </div>
      ))}
    </div>
  );
}

function RawTraceBlock({ raw }) {
  return (
    <details className="mt-3 rounded-lg border bg-background/50">
      <summary className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
        Raw CLI output
      </summary>
      <div className="space-y-3 border-t p-3">
        {raw.stdout ? (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">stdout</div>
            <pre className="max-h-72 overflow-auto rounded-md bg-muted/35 p-3 font-mono text-xs leading-5 text-muted-foreground">
              <code>{raw.stdout}</code>
            </pre>
          </div>
        ) : null}
        {raw.stderr ? (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">stderr</div>
            <pre className="max-h-72 overflow-auto rounded-md bg-muted/35 p-3 font-mono text-xs leading-5 text-muted-foreground">
              <code>{raw.stderr}</code>
            </pre>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function WorkspaceField({ workspace, setWorkspace, workspaces, runtime }) {
  const workspaceChoices = workspaceOptions(workspaces, workspace, runtime);
  const blocked = isBlockedWorkspace(workspace, runtime);
  return (
    <Field>
      <FieldLabel>Workspace</FieldLabel>
      <Select value={blocked ? undefined : workspace} onValueChange={setWorkspace} disabled={!workspaceChoices.length}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Scanning local folders" />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-[420px]">
          <SelectGroup>
            <SelectLabel>Folders under {runtime?.workspaceRoot || "user directory"}</SelectLabel>
            {workspaceChoices.map((item) => (
              <SelectItem key={item.path} value={item.path}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription className="truncate">
        {blocked
          ? "Choose a project folder or git repo. Home is blocked by Autohand CLI."
          : workspace || `Folders under ${runtime?.workspaceRoot || "your user directory"}`}
      </FieldDescription>
    </Field>
  );
}

function RuntimeBeacon({ runtime, latestRun }) {
  return (
    <Card className="overflow-hidden border-border/80 bg-card/75 shadow-xl shadow-black/15">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TerminalSquare />
          Runtime
        </CardTitle>
        <CardDescription>{runtime?.available ? "ready" : "offline"}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-3">
          <span className="runtime-glow grid size-12 place-items-center rounded-lg bg-primary text-primary-foreground">
            <TerminalSquare />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{runtime?.autohandPath || "not found"}</div>
            <div className="text-xs text-muted-foreground">{runtime?.version || "checking runtime"}</div>
          </div>
        </div>
        <Separator />
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Metric label="Latest" value={latestRun?.status || "idle"} />
          <Metric label="Root" value={workspaceName(runtime?.workspaceRoot) || "home"} />
          <Metric label="Mode" value="local" />
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/35 p-3">
      <div className="min-w-0 truncate text-sm font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function formatShortDate(value, locale = DEFAULT_LOCALE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatLongDate(value, locale = DEFAULT_LOCALE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatRecordDate(value, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  if (!value) return copy.never;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatAutomationDate(value, locale = DEFAULT_LOCALE) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatClockTime(value, locale = DEFAULT_LOCALE) {
  const [hour = "09", minute = "00"] = String(value || "09:00").split(":");
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
}

function automationScheduleLabel(automation, locale = DEFAULT_LOCALE) {
  if (automation.triggerType === "event") {
    return `${automation.eventSource || "Git"}: ${String(automation.eventType || "repository event").replaceAll("_", " ")}`;
  }
  if (automation.triggerType === "webhook") {
    return "Webhook or API call";
  }
  if (automation.scheduleFrequency === "manual") {
    return "Manual only";
  }
  const frequency = AUTOMATION_SCHEDULE_FREQUENCIES.find((item) => item.id === automation.scheduleFrequency)?.label || "Daily";
  return `${frequency} at ${formatClockTime(automation.scheduleTime, locale)}`;
}

function automationNextRunLabel(automation, locale = DEFAULT_LOCALE) {
  if (automation.status === "paused") return "Paused";
  if (automation.triggerType === "event") return `Waiting for ${automation.eventSource || "Git"} event`;
  if (automation.triggerType === "webhook") return "Waiting for webhook/API call";
  if (automation.scheduleFrequency === "manual") return "Manual run only";
  return `Tomorrow ${formatClockTime(automation.scheduleTime, locale)}`;
}

function automationTriggerTitle(automation) {
  if (automation.triggerType === "event") return "Event";
  if (automation.triggerType === "webhook") return "Webhook";
  return "Schedule";
}

function compactRecordId(id) {
  const value = String(id || "");
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-4)}`;
}

function taskSourceLabel(source, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  if (source === "automation") return copy.automation;
  if (source === "local-chat" || source === "conversation") return copy.localChat;
  return source ? String(source).replaceAll("-", " ") : copy.localChat;
}

function taskAgentIds(task) {
  const ids = [
    task?.agentId,
    task?.currentOwnerId,
    task?.originAgentId,
    ...(Array.isArray(task?.assignments) ? task.assignments.flatMap((assignment) => [assignment.agentId, assignment.sourceAgentId]) : []),
    ...(Array.isArray(task?.handoffs) ? task.handoffs.flatMap((handoff) => [handoff.fromAgentId, handoff.toAgentId]) : []),
  ];
  return new Set(ids.map(normalizeSquadMemberId).filter(Boolean));
}

function taskBelongsToAgent(task, agentId) {
  const normalizedId = normalizeSquadMemberId(agentId);
  return Boolean(normalizedId && taskAgentIds(task).has(normalizedId));
}

function taskOwner(task, agents = []) {
  const ownerId = normalizeSquadMemberId(task?.currentOwnerId || task?.agentId);
  return agents.find((agent) => agent.id === ownerId);
}

function latestHandoff(task) {
  const handoffs = Array.isArray(task?.handoffs) ? task.handoffs : [];
  return handoffs[handoffs.length - 1] || null;
}

function latestPendingHandoff(task) {
  return [...(Array.isArray(task?.handoffs) ? task.handoffs : [])].reverse().find((handoff) => handoff.status === "pending") || null;
}

function latestFailedHandoff(task) {
  return [...(Array.isArray(task?.handoffs) ? task.handoffs : [])].reverse().find((handoff) => handoff.status === "failed") || null;
}

function handoffContextText(handoff, task, sourceAgent, targetAgent) {
  const lines = [
    `Handoff received from ${sourceAgent?.name || "another squad member"} for parent task: ${task.title}`,
    "",
    `Current owner: ${targetAgent?.name || "this squad member"}`,
    `Reason: ${handoff.reason || "Continue the parent task."}`,
    `Required context: ${handoff.requiredContext || task.summary || "Use the preserved task timeline."}`,
    `Expected output: ${handoff.expectedOutput || "Continue the task and report evidence."}`,
  ];
  if (handoff.sourceEvidence) lines.push(`Source evidence: ${handoff.sourceEvidence}`);
  lines.push("", "Keep this as the same parent task. Add your work as the next child assignment or run.");
  return lines.join("\n");
}

function getAgentStrengths(agent, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  if (agent?.employeeType === "common-qa-engineer" || agent?.role === "QA Engineer") {
    return copy.qaStrengths;
  }
  return normalizeSkillList(agent?.skills).slice(0, 5).map((skill) => localizedSkillLabel(skill, copy));
}

function AgentPhotoCard({ agent, className, compact = false }) {
  return (
    <div
      className={cn(
        "w-fit -rotate-3 rounded-md border border-border/80 bg-[#111] shadow-2xl shadow-black/40",
        compact ? "p-2" : "p-3",
        className
      )}
    >
      <div className={cn("rounded-sm bg-[#dcd2ff] p-2", compact ? "w-[136px]" : "w-[164px]")}>
        <AgentAvatar agent={agent} large className={cn("rounded-sm border-0", compact ? "size-[120px]" : "size-[148px]")} />
      </div>
      <div className="mt-2 text-center font-mono text-xs text-muted-foreground">ID: {agent.staffId}</div>
    </div>
  );
}

function CapabilityRow({ icon: Icon, title, detail }) {
  return (
    <button
      type="button"
      className="grid min-h-14 w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border/80 py-3 text-left transition-colors hover:bg-muted/20"
    >
      <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {detail ? <span className="mt-1 block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
}

function AgentProfilePreviewDialog({ agent, tasks, automations, open, onOpenChange, onViewDetails, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const strengths = getAgentStrengths(agent, copy);
  const taskCount = tasks.length || agent.stats?.tasks || 0;
  const automationCount = automations.length || agent.stats?.automations || 0;
  const activeDays = agent.stats?.activeDays ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={copy.close} className="max-h-[88svh] overflow-y-auto rounded-md border-border bg-background p-0 sm:max-w-[680px]">
        <DialogHeader className="sr-only">
          <DialogTitle>{formatCopy(copy.profilePreviewTitle, { name: agent.name })}</DialogTitle>
          <DialogDescription>{formatCopy(copy.profilePreviewDescription, { name: agent.name })}</DialogDescription>
        </DialogHeader>

        <div className="p-5 sm:p-6">
          <div className="rounded-md border bg-card/80 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-[168px_minmax(0,1fr)] sm:items-start">
              <AgentPhotoCard
                agent={agent}
                compact
              />

              <div className="min-w-0 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-normal">{agent.name}</h2>
                  <Badge variant="outline" className="rounded-md border-border/80 bg-muted/30">
                    <ClipboardCheck data-icon="inline-start" />
                    {localizedRole(agent, copy)}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-2 text-primary">
                    <span className="size-2 rounded-full bg-primary" />
                    {copy.online}
                  </span>
                  <Separator orientation="vertical" className="h-4" />
                  <span>{copy.onboarding}: {formatShortDate(agent.createdAt, locale)}</span>
                </div>
              </div>
            </div>

            <Separator className="mt-5 border-dashed" />

            <div className="grid grid-cols-3 gap-2 py-4 text-center">
              <div>
                <div className="text-2xl font-semibold tracking-normal">{formatLocalizedNumber(activeDays, locale)}<span className="ml-1 text-sm">d</span></div>
                <div className="mt-1 text-xs text-muted-foreground">{copy.onboarded}</div>
              </div>
              <button type="button" className="rounded-md transition-colors hover:bg-muted/30" onClick={onViewDetails}>
                <div className="text-2xl font-semibold tracking-normal">{formatLocalizedNumber(automationCount, locale)}</div>
                <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {copy.automation}
                  <ChevronRight className="size-3.5" />
                </div>
              </button>
              <button type="button" className="rounded-md transition-colors hover:bg-muted/30" onClick={onViewDetails}>
                <div className="text-2xl font-semibold tracking-normal">{formatLocalizedNumber(taskCount, locale)}</div>
                <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {copy.tasks}
                  <ChevronRight className="size-3.5" />
                </div>
              </button>
            </div>
          </div>

          <section className="mt-5">
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{copy.goodAt}</h3>
            <div className="flex flex-wrap gap-2">
              {strengths.map((strength) => (
                <Badge key={strength} variant="outline" className="rounded-full border-border/80 bg-transparent px-3 py-1.5 text-xs text-foreground">
                  {strength}
                </Badge>
              ))}
            </div>
          </section>

          <section className="mt-6">
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{copy.capabilitiesTools}</h3>
            <CapabilityRow icon={BrainCog} title={copy.memory} detail={formatCopy(copy.learnedEntries, { count: formatLocalizedNumber(agent.memory?.length || 0, locale) })} />
            <CapabilityRow icon={Sparkles} title={formatCopy(copy.skillWithCount, { count: formatLocalizedNumber(normalizeSkillList(agent.skills).length, locale) })} detail={copy.installedFromSkillRegistry} />
            <CapabilityRow icon={Unplug} title={copy.connector} detail={formatCopy(copy.localToolsAvailable, { count: formatLocalizedNumber(agent.tools?.length || 0, locale) })} />
          </section>

          <Button className="mt-6 h-10 w-full text-sm" onClick={onViewDetails}>
            {copy.viewDetails}
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HandoffTimelinePanel({ tasks = [], agents = [], locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const events = tasks
    .flatMap((task) =>
      (Array.isArray(task.timeline) ? task.timeline : []).map((event) => ({
        ...event,
        taskId: task.id,
        taskTitle: task.title,
        ownerId: task.currentOwnerId || task.agentId,
      }))
    )
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, 8);

  if (!events.length) {
    return <EmptyBlock icon={History} title={copy.noTasksYet} body="Handoff timeline events appear here after a task changes owner." />;
  }

  return (
    <section className="rounded-md border bg-muted/20 p-4" aria-label="Handoff timeline">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Handoff timeline</h3>
          <p className="mt-1 text-xs text-muted-foreground">Same parent task, child assignments, and ownership changes.</p>
        </div>
        <Badge variant="outline" className="rounded-md">{events.length} events</Badge>
      </div>
      <div className="space-y-3 border-l border-border/80 pl-4">
        {events.map((event) => {
          const actor = agents.find((agent) => agent.id === event.actorAgentId);
          const target = agents.find((agent) => agent.id === event.targetAgentId);
          const owner = agents.find((agent) => agent.id === event.ownerId);
          return (
            <article key={event.id || `${event.type}-${event.taskId}-${event.at}`} className="relative">
              <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[10px]">{event.type?.replaceAll(".", " ") || "event"}</Badge>
                <time>{formatRecordDate(event.at, locale, copy)}</time>
                <span>Owner: {owner?.name || event.ownerId || "unassigned"}</span>
              </div>
              <div className="mt-1 text-sm font-medium">{event.summary || event.taskTitle}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {actor?.name || "Squad member"}{target ? ` -> ${target.name}` : ""} / parent {compactRecordId(event.taskId)}
              </div>
              {event.content ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{event.content}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function WorkRecordTasksTable({ tasks, copy = getLocaleCopy(DEFAULT_LOCALE), locale = DEFAULT_LOCALE }) {
  if (!tasks.length) {
    return <EmptyBlock icon={LayoutList} title={copy.noTasksYet} body={formatCopy(copy.tasksAppearAfterChatWork, { name: "Eva" })} />;
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/55">
            <TableHead className="w-[150px]">ID</TableHead>
            <TableHead>{copy.name}</TableHead>
            <TableHead className="w-[160px]">{copy.source}</TableHead>
            <TableHead className="w-[150px]">{copy.status}</TableHead>
            <TableHead className="w-[180px]">{copy.created}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TableRow key={task.id}>
              <TableCell className="font-mono text-muted-foreground">{compactRecordId(task.id)}</TableCell>
              <TableCell className="max-w-[520px] truncate font-medium">{task.title}</TableCell>
              <TableCell>
                <Badge variant="secondary" className="rounded-md bg-muted text-muted-foreground">
                  {taskSourceLabel(task.source, copy)}
                </Badge>
              </TableCell>
              <TableCell><StatusBadge status={task.status} copy={copy} /></TableCell>
              <TableCell>{formatRecordDate(task.createdAt || task.updatedAt, locale, copy)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function WorkRecordAutomationsTable({ automations, copy = getLocaleCopy(DEFAULT_LOCALE), locale = DEFAULT_LOCALE }) {
  if (!automations.length) {
    return <EmptyBlock icon={Workflow} title={copy.noAutomationsYet} body={copy.scheduledLocalAutohandWork} />;
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/55">
            <TableHead>{copy.name}</TableHead>
            <TableHead className="w-[160px]">Run Count</TableHead>
            <TableHead className="w-[220px]">{copy.created}</TableHead>
            <TableHead className="w-[220px]">Last Run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {automations.map((automation) => (
            <TableRow key={automation.id}>
              <TableCell className="font-medium">{automation.name}</TableCell>
              <TableCell>{automation.runCount ?? (automation.lastRun && automation.lastRun !== "Never" ? 1 : 0)}</TableCell>
              <TableCell>{formatRecordDate(automation.createdAt, locale, copy)}</TableCell>
              <TableCell>{formatRecordDate(automation.lastRun, locale, copy)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MessagesCard({ agent, messages }) {
  return (
    <Card className="border-border/80 bg-card/70 shadow-xl shadow-black/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareText />
          Conversation
        </CardTitle>
        <CardDescription>Run context and Autohand launch feedback</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {messages.map((message) => (
            <article
              key={message.id}
              className={cn(
                "rounded-lg border p-4",
                message.role === "user" ? "ml-auto max-w-3xl border-primary/45 bg-primary/10" : "max-w-4xl bg-muted/35"
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{message.role === "user" ? "You" : agent.name}</span>
                <time>{message.time}</time>
              </div>
              <MarkdownBlocks text={message.body} muted={message.role !== "user"} />
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TaskPanel({
  agents = [],
  activeAgent,
  tasks,
  runs,
  automations,
  setAutomations,
  runAutomation,
  activeTab = "runs",
  setActiveTab,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  handoffRetryMode = DEFAULT_HANDOFF_RETRY_MODE,
  onCreateHandoff,
  onCancelHandoff,
  onFailHandoff,
  onRetryHandoff,
}) {
  const [handoffSource, setHandoffSource] = useState(null);
  const handoffCount = tasks.filter((task) => latestHandoff(task)).length;
  const blockedCount = tasks.filter((task) => latestFailedHandoff(task)).length;

  function openTaskHandoff(task, handoff = null) {
    setHandoffSource({ type: "task", task, handoff, sourceAgentId: task.currentOwnerId || task.agentId });
  }

  function openRunHandoff(run) {
    const linkedTask = tasks.find((task) => task.runtimeId === run.id);
    setHandoffSource({ type: "run", run, task: linkedTask, sourceAgentId: run.agentId || activeAgent?.id });
  }

  function saveHandoff(draft) {
    onCreateHandoff?.(handoffSource, draft);
    setHandoffSource(null);
  }

  return (
    <div className="flex h-full min-h-screen flex-col">
      <SheetHeader className="border-b p-5">
        <SheetTitle>{copy.execution}</SheetTitle>
        <SheetDescription>{copy.executionDescription}</SheetDescription>
      </SheetHeader>
      <div className="grid grid-cols-3 gap-2 border-b px-5 py-3">
        <Metric label="Parent tasks" value={tasks.length} />
        <Metric label="Handoffs" value={handoffCount} />
        <Metric label="Blocked" value={blockedCount} />
      </div>
      <MissionControlStrip tasks={tasks} agents={agents} />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-5 py-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="runs">{copy.runs}</TabsTrigger>
            <TabsTrigger value="tasks">{copy.tasks}</TabsTrigger>
            <TabsTrigger value="automations">{copy.automations}</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="runs" className="m-0 p-5">
            <RunList runs={runs} tasks={tasks} agents={agents} copy={copy} onHandoff={openRunHandoff} />
          </TabsContent>
          <TabsContent value="tasks" className="m-0 p-5">
            <TaskList
              tasks={tasks}
              agents={agents}
              copy={copy}
              handoffRetryMode={handoffRetryMode}
              onHandoff={openTaskHandoff}
              onCancelHandoff={onCancelHandoff}
              onFailHandoff={onFailHandoff}
              onRetryHandoff={onRetryHandoff}
            />
          </TabsContent>
          <TabsContent value="automations" className="m-0 p-5">
            <AutomationList automations={automations} setAutomations={setAutomations} runAutomation={runAutomation} copy={copy} />
          </TabsContent>
        </ScrollArea>
      </Tabs>
      <HandoffDialog
        open={Boolean(handoffSource)}
        source={handoffSource}
        agents={agents}
        activeAgent={activeAgent}
        copy={copy}
        onOpenChange={(open) => !open && setHandoffSource(null)}
        onSave={saveHandoff}
      />
    </div>
  );
}

function MissionControlStrip({ tasks = [], agents = [] }) {
  const activeTasks = tasks.filter((task) => !["completed", "cancelled"].includes(task.status));
  const blockedTasks = tasks.filter((task) => task.status === "blocked" || latestFailedHandoff(task));
  const visibleTasks = [...activeTasks, ...tasks].filter((task, index, list) => list.findIndex((item) => item.id === task.id) === index).slice(0, 3);

  return (
    <section className="border-b bg-muted/20 px-5 py-4" aria-label="Mission Control">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Mission Control</h3>
          <p className="mt-1 text-xs text-muted-foreground">Current owners, handoff state, and blocked checkpoints.</p>
        </div>
        <Badge variant={blockedTasks.length ? "destructive" : "secondary"} className="rounded-md">
          {blockedTasks.length} blocked
        </Badge>
      </div>
      <div className="grid gap-2">
        {visibleTasks.length ? (
          visibleTasks.map((task) => {
            const owner = taskOwner(task, agents);
            const handoff = latestHandoff(task);
            return (
              <div key={task.id} className="rounded-md border bg-background/65 px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">{task.title}</span>
                  <StatusBadge status={task.status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Owner: {owner?.name || task.currentOwnerId || "unassigned"}</span>
                  {handoff ? <span>Latest handoff: {handoff.status}</span> : null}
                  <span>{(task.assignments || []).length} assignments</span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-md border bg-background/65 px-3 py-2 text-sm text-muted-foreground">
            No active handoffs.
          </div>
        )}
      </div>
    </section>
  );
}

function RunList({ runs, tasks = [], agents = [], copy = getLocaleCopy(DEFAULT_LOCALE), onHandoff }) {
  if (!runs.length) {
    return <EmptyBlock icon={TerminalSquare} title={copy.noAutohandRuns} body={copy.runsAppearAfterLaunch} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {runs.map((run) => (
        <Card key={run.id} className="gap-3 rounded-lg py-4 shadow-none">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <StatusIcon status={run.status} />
              {run.title}
            </CardTitle>
            <CardDescription>{run.workspace}</CardDescription>
            <CardAction>
              <div className="flex items-center gap-2">
                <StatusBadge status={run.status} copy={copy} />
                <Button type="button" variant="outline" size="sm" onClick={() => onHandoff?.(run)}>
                  <Workflow data-icon="inline-start" />
                  Handoff
                </Button>
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="px-4">
            {run.agentId ? (
              <div className="mb-2 text-xs text-muted-foreground">
                Owner: {agents.find((agent) => agent.id === run.agentId)?.name || run.agentId}
                {tasks.some((task) => task.runtimeId === run.id) ? " / linked parent task" : " / standalone run"}
              </div>
            ) : null}
            <code className="block truncate rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{run.command}</code>
            {run.displayConfigPath ? (
              <div className="mt-2 truncate text-[11px] text-muted-foreground">Config: {run.displayConfigPath}</div>
            ) : null}
            <pre className="mt-3 max-h-44 overflow-auto rounded-md bg-background p-3 text-xs leading-5 text-muted-foreground">
              {run.logs.length
                ? run.logs.slice(-9).map((log) => `[${log.source}] ${log.line}`).join("\n")
                : "waiting for output..."}
            </pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TaskList({
  tasks,
  agents = [],
  copy = getLocaleCopy(DEFAULT_LOCALE),
  handoffRetryMode = DEFAULT_HANDOFF_RETRY_MODE,
  onHandoff,
  onCancelHandoff,
  onFailHandoff,
  onRetryHandoff,
}) {
  if (!tasks.length) {
    return <EmptyBlock icon={LayoutList} title={copy.noTasksYet} body={copy.startAutohandFromLaunchSurface} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {tasks.map((task) => {
        const owner = taskOwner(task, agents);
        const handoff = latestHandoff(task);
        const pendingHandoff = latestPendingHandoff(task);
        const failedHandoff = latestFailedHandoff(task);
        const fromAgent = agents.find((agent) => agent.id === handoff?.fromAgentId);
        const toAgent = agents.find((agent) => agent.id === handoff?.toAgentId);
        return (
        <div key={task.id} className="rounded-lg border bg-muted/25 p-4">
          <div className="mb-3 flex items-center gap-2">
            <StatusIcon status={task.status} />
            <StatusBadge status={task.status} copy={copy} />
            <Badge variant="outline" className="rounded-md bg-background/50">
              Owner: {owner?.name || task.currentOwnerId || task.agentId || "unassigned"}
            </Badge>
            <time className="ml-auto text-xs text-muted-foreground">{formatRecordDate(task.updatedAt, DEFAULT_LOCALE, copy)}</time>
          </div>
          <div className="font-semibold">{task.title}</div>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{task.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{task.project}</Badge>
            <Badge variant="secondary" className="rounded-md">
              {(task.assignments || []).length} child assignment{(task.assignments || []).length === 1 ? "" : "s"}
            </Badge>
            {handoff ? (
              <Badge variant={handoff.status === "failed" ? "destructive" : "outline"} className="rounded-md">
                {handoff.status} handoff
              </Badge>
            ) : null}
          </div>

          {handoff ? (
            <div className="mt-4 rounded-md border bg-background/55 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Workflow className="size-4 text-primary" />
                <span className="font-semibold">{fromAgent?.name || "Source"}{" -> "}{toAgent?.name || "Target"}</span>
                <span className="text-xs text-muted-foreground">attempt {handoff.attempt || 1}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{handoff.reason || "No reason provided."}</p>
              {handoff.failureReason ? (
                <p className="mt-2 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {handoff.failureReason}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingHandoff ? (
                  <>
                    <Button type="button" variant="outline" size="sm" onClick={() => onCancelHandoff?.(task, pendingHandoff)}>
                      <X data-icon="inline-start" />
                      Cancel
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => onHandoff?.(task, pendingHandoff)}>
                      <ArrowUpRight data-icon="inline-start" />
                      Reroute
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => onFailHandoff?.(task, pendingHandoff)}>
                      <AlertTriangle data-icon="inline-start" />
                      Mark blocked
                    </Button>
                  </>
                ) : null}
                {failedHandoff && handoffRetryMode === "checkpoint" ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onRetryHandoff?.(task, failedHandoff)}>
                    <RefreshCw data-icon="inline-start" />
                    Retry checkpoint
                  </Button>
                ) : null}
                {failedHandoff && handoffRetryMode === "manual" ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onHandoff?.(task, failedHandoff)}>
                    <ArrowUpRight data-icon="inline-start" />
                    Reroute manually
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <TaskTimelinePreview task={task} agents={agents} />
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => onHandoff?.(task)}>
              <Workflow data-icon="inline-start" />
              Handoff
            </Button>
          </div>
        </div>
        );
      })}
    </div>
  );
}

function TaskTimelinePreview({ task, agents = [] }) {
  const timeline = Array.isArray(task.timeline) ? task.timeline.slice(-4) : [];
  if (!timeline.length) return null;
  return (
    <div className="mt-4 border-l border-border/80 pl-3">
      {timeline.map((event) => {
        const actor = agents.find((agent) => agent.id === event.actorAgentId);
        const target = agents.find((agent) => agent.id === event.targetAgentId);
        return (
          <div key={event.id || `${event.type}-${event.at}`} className="pb-3 last:pb-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-primary" />
              <span>{event.type?.replaceAll(".", " ") || "timeline"}</span>
              <span>{formatRecordDate(event.at)}</span>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {event.summary}
              {target && target.id !== actor?.id ? ` Current target: ${target.name}.` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function recommendedHandoffTargets(source, agents = [], activeAgent) {
  const sourceAgentId = normalizeSquadMemberId(source?.sourceAgentId || source?.task?.currentOwnerId || source?.task?.agentId || activeAgent?.id);
  const sourceAgent = agents.find((agent) => agent.id === sourceAgentId) || activeAgent;
  const role = String(sourceAgent?.role || sourceAgent?.employeeType || "").toLowerCase();
  const preferredRoles = role.includes("qa")
    ? ["frontend", "full stack", "backend"]
    : role.includes("frontend")
      ? ["qa", "solution", "devops"]
      : role.includes("backend")
        ? ["qa", "security", "devops"]
        : ["qa", "frontend", "devops"];
  return agents
    .filter((agent) => agent.id !== sourceAgentId)
    .map((agent) => {
      const targetRole = `${agent.role || ""} ${agent.employeeType || ""}`.toLowerCase();
      const score = preferredRoles.findIndex((preferred) => targetRole.includes(preferred));
      return { agent, recommended: score >= 0, score: score >= 0 ? score : 99 };
    })
    .sort((left, right) => left.score - right.score || String(left.agent.name).localeCompare(String(right.agent.name)));
}

function HandoffDialog({ open, source, agents = [], activeAgent, copy = getLocaleCopy(DEFAULT_LOCALE), onOpenChange, onSave }) {
  const sourceTask = source?.task;
  const sourceRun = source?.run;
  const sourceHandoff = source?.handoff;
  const sourceAgentId = normalizeSquadMemberId(source?.sourceAgentId || sourceTask?.currentOwnerId || sourceTask?.agentId || sourceRun?.agentId || activeAgent?.id);
  const sourceAgent = agents.find((agent) => agent.id === sourceAgentId) || activeAgent;
  const targets = recommendedHandoffTargets(source, agents, activeAgent);
  const firstTarget = targets[0]?.agent;
  const [draft, setDraft] = useState({
    targetAgentId: "",
    reason: "",
    requiredContext: "",
    expectedOutput: "",
    sourceEvidence: "",
  });

  useEffect(() => {
    if (!open) return;
    const defaultEvidence = sourceRun
      ? `Run ${sourceRun.id?.slice(0, 8) || "unknown"} / ${sourceRun.status || "status unknown"} / ${sourceRun.workspace || "workspace"}`
      : sourceTask?.runtimeId
        ? `Runtime ${sourceTask.runtimeId}`
        : sourceTask?.project || "";
    setDraft({
      targetAgentId: sourceHandoff?.toAgentId || firstTarget?.id || "",
      reason: sourceHandoff?.failureReason
        ? `Retry after blocked handoff: ${sourceHandoff.failureReason}`
        : sourceHandoff?.reason || "",
      requiredContext: sourceHandoff?.requiredContext || sourceTask?.summary || sourceRun?.command || "",
      expectedOutput: sourceHandoff?.expectedOutput || "Inspect the preserved context, continue the same parent task, and report evidence.",
      sourceEvidence: sourceHandoff?.sourceEvidence || defaultEvidence,
    });
  }, [open, sourceHandoff, sourceRun, sourceTask, firstTarget?.id]);

  function updateDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function submit(event) {
    event.preventDefault();
    if (!draft.targetAgentId || draft.targetAgentId === sourceAgentId) return;
    onSave?.(draft);
  }

  const selectedTarget = agents.find((agent) => agent.id === draft.targetAgentId);
  const validTargets = targets.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={copy.close} className="max-h-[88svh] overflow-y-auto rounded-md border-border bg-background p-0 sm:max-w-[680px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>Handoff parent task</DialogTitle>
          <DialogDescription>
            Keep the same parent task and create a child assignment for the receiving squad member.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="grid gap-5 p-6">
            <div className="rounded-md border bg-muted/30 p-4">
              <div className="text-sm font-semibold">{sourceTask?.title || sourceRun?.title || "Run handoff"}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">From {sourceAgent?.name || "current owner"}</Badge>
                {selectedTarget ? <Badge variant="outline">To {selectedTarget.name}</Badge> : null}
                {sourceTask ? <Badge variant="secondary">Parent {compactRecordId(sourceTask.id)}</Badge> : null}
                {sourceRun ? <Badge variant="secondary">Run {compactRecordId(sourceRun.id)}</Badge> : null}
              </div>
            </div>

            <Field>
              <FieldLabel>Next squad member</FieldLabel>
              <Select value={draft.targetAgentId} onValueChange={(targetAgentId) => updateDraft({ targetAgentId })} disabled={!validTargets}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Choose receiving squad member" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Online squad members</SelectLabel>
                    {targets.map(({ agent, recommended }) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name} / {localizedRole(agent, copy)}{recommended ? " / recommended" : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                Recommendations do not require user confirmation by default; saved recipes or automations can add approval rules later.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Reason</FieldLabel>
              <Input value={draft.reason} onChange={(event) => updateDraft({ reason: event.target.value })} placeholder="Why this squad member should take over" />
            </Field>

            <Field>
              <FieldLabel>Required context</FieldLabel>
              <Textarea
                value={draft.requiredContext}
                onChange={(event) => updateDraft({ requiredContext: event.target.value })}
                className="min-h-24 resize-y"
                placeholder="What the receiving member needs to know"
              />
            </Field>

            <Field>
              <FieldLabel>Expected output</FieldLabel>
              <Textarea
                value={draft.expectedOutput}
                onChange={(event) => updateDraft({ expectedOutput: event.target.value })}
                className="min-h-20 resize-y"
                placeholder="What the receiving member should produce"
              />
            </Field>

            <Field>
              <FieldLabel>Source evidence</FieldLabel>
              <Textarea
                value={draft.sourceEvidence}
                onChange={(event) => updateDraft({ sourceEvidence: event.target.value })}
                className="min-h-20 resize-y font-mono text-sm"
                placeholder="Run IDs, files, screenshots, logs, findings"
              />
            </Field>
          </div>
          <DialogFooter className="sticky bottom-0 border-t bg-background/95 px-6 py-4 backdrop-blur">
            <Button type="button" variant="ghost" onClick={() => onOpenChange?.(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!draft.targetAgentId || draft.targetAgentId === sourceAgentId}>
              Create handoff
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AutomationList({ automations, setAutomations, runAutomation, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  return (
    <div className="flex flex-col gap-3">
      {automations.map((automation) => (
        <div key={automation.id} className="rounded-lg border bg-muted/25 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">{automation.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">{automationScheduleLabel(automation)}</div>
              <Badge variant="outline" className="mt-3">{workspaceName(automation.workspace) || automation.target}</Badge>
            </div>
            <Switch
              checked={automation.status === "active"}
              onCheckedChange={() =>
                setAutomations((current) =>
                  current.map((item) =>
                    item.id === automation.id
                      ? { ...item, status: item.status === "active" ? "paused" : "active" }
                      : item
                  )
                )
              }
            />
          </div>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => runAutomation(automation)}>
            <Play data-icon="inline-start" />
            {copy.runNow}
          </Button>
        </div>
      ))}
    </div>
  );
}

function EmptyBlock({ icon: Icon, title, body }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent />
    </Empty>
  );
}

function StatusIcon({ status }) {
  if (status === "completed") return <CheckCircle2 className="text-primary" />;
  if (status === "failed" || status === "blocked") return <AlertTriangle className="text-destructive" />;
  if (status === "running" || status === "launching" || status === "handoff-pending") return <Activity className="text-primary" />;
  return <CircleDot className="text-muted-foreground" />;
}

function StatusBadge({ status, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const value = status || "idle";
  return (
    <Badge
      variant={value === "failed" || value === "blocked" || value === "offline" ? "destructive" : value === "ready" || value === "completed" ? "default" : "secondary"}
      className="capitalize"
    >
      {statusLabel(value, copy)}
    </Badge>
  );
}

function RoleAvatar({ roleId, src, alt, size = "default" }) {
  const visual = roleVisuals[roleId] || roleVisuals["custom-role"];
  const Icon = visual.icon;
  const sizes = {
    default: "size-10",
    large: "size-20",
  };
  const iconSizes = {
    default: "size-5",
    large: "size-9",
  };

  if (src) {
    return (
      <Avatar className={cn("rounded-full border border-border/70 bg-muted", sizes[size])}>
        <AvatarImage src={src} alt={alt || "Squad member avatar"} className="object-cover" />
        <AvatarFallback className="rounded-full bg-muted">
          <Icon className={iconSizes[size]} />
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full", sizes[size], visual.className)}>
      <Icon className={iconSizes[size]} />
    </span>
  );
}

function parseDelimitedList(value) {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function profileSectionById(sectionId) {
  return CUSTOM_ROLE_SECTIONS.find((section) => section.id === sectionId);
}

function normalizeProfileFileName(section, originalFileName) {
  const fallback = section?.fileName || "PROFILE.md";
  const baseName = String(originalFileName || "")
    .split(/[/\\]/)
    .filter(Boolean)
    .at(-1);
  if (!baseName) return fallback;

  const lowerName = baseName.toLowerCase();
  const alias = section?.aliases?.find((item) => item.toLowerCase() === lowerName);
  if (alias) return alias;
  return lowerName === fallback.toLowerCase() ? fallback : fallback;
}

function normalizeProfileFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .map((file) => {
      const section = profileSectionById(file?.section);
      if (!section) return null;
      const content = String(file?.content || "").trim();
      if (!content) return null;
      const originalFileName = String(file?.originalFileName || file?.fileName || "").trim();
      return {
        section: section.id,
        fileName: normalizeProfileFileName(section, originalFileName),
        originalFileName,
        content,
        source: file?.source === "upload" ? "upload" : file?.source === "manual" ? "manual" : "generated",
      };
    })
    .filter(Boolean);
}

function profileFilesFromDraft(templateDraft) {
  return normalizeProfileFiles(
    CUSTOM_ROLE_SECTIONS.map((section) => ({
      section: section.id,
      fileName: section.fileName,
      originalFileName: templateDraft.sectionFileNames?.[section.id] || "",
      content: templateDraft.sections[section.id] || "",
      source: templateDraft.sectionFileNames?.[section.id] ? "upload" : "manual",
    }))
  );
}

function defaultProfileFileContent(agent, sectionId) {
  const skills = normalizeSkillList(agent?.skills);
  const memoryItems = Array.isArray(agent?.memory) ? agent.memory : [];
  const projects = normalizeAgentProjects(agent?.projects, agent?.workspace);
  const name = agent?.name || "Autohand agent";
  const role = agent?.role || "Software engineering agent";

  if (sectionId === "identity") {
    return [
      "# Identity",
      `Name: ${name}`,
      `Role: ${role}`,
      agent?.description ? `Responsibilities:\n${agent.description}` : "Responsibilities:\nWork as the configured Autohand Squad member for the selected local workspace.",
      projects.length ? `Associated projects:\n${projects.map((project) => `- ${project.label || project.name}: ${project.path}`).join("\n")}` : "",
    ].join("\n\n");
  }

  if (sectionId === "persona") {
    return [
      "# Persona",
      agent?.instructions || `Act as ${role}. Keep work scoped, ask when role boundaries are unclear, and report evidence clearly.`,
      "Collaboration defaults:\n- Match the role selected in Autohand Squad.\n- Keep local work isolated to this squad member's Autohand home.\n- Use concise, evidence-backed status updates.",
    ].join("\n\n");
  }

  if (sectionId === "bible") {
    return [
      "# Bible",
      "Workflow:\n- Inspect the selected workspace before acting.\n- Keep changes scoped to the user's request.\n- Use installed profile skills when they match the task.\n- Report validation evidence after running local Autohand work.",
      skills.length ? `Profile skills:\n${skills.map((skill) => `- ${skill}`).join("\n")}` : "Profile skills:\n- No skills selected yet.",
    ].join("\n\n");
  }

  return [
    "# Memory",
    "Durable context for this squad member:",
    memoryItems.length ? memoryItems.map((item) => `- ${item}`).join("\n") : "- Created from Autohand Squad.",
    `Skill source: ${agent?.skillSource || AUTOHAND_SKILLS_REGISTRY_URL}`,
  ].join("\n\n");
}

function buildAgentProfileFiles(agent) {
  const provided = new Map(normalizeProfileFiles(agent?.profileFiles).map((file) => [file.section, file]));
  return CUSTOM_ROLE_SECTIONS.map((section) => {
    const file = provided.get(section.id);
    return {
      section: section.id,
      fileName: file?.fileName || section.fileName,
      originalFileName: file?.originalFileName || file?.fileName || "",
      content: file?.content || defaultProfileFileContent(agent, section.id),
      source: file?.source || "generated",
    };
  });
}

function profileEditDraftFromAgent(agent) {
  return {
    name: agent?.name || "",
    role: agent?.role || "",
    description: agent?.description || "",
    instructions: agent?.instructions || "",
    avatar: agent?.avatar || "",
    skillsText: normalizeSkillList(agent?.skills).join("\n"),
  };
}

function skillInstallFromEditedSkills(agent, skills) {
  const existing = agent?.skillInstall && typeof agent.skillInstall === "object" ? agent.skillInstall : {};
  const skillSet = new Set(skills);
  const installed = Array.isArray(existing.installed)
    ? existing.installed.filter((item) => skillSet.has(normalizeSkillId(item?.id)))
    : [];
  const failed = Array.isArray(existing.failed)
    ? existing.failed.filter((item) => skillSet.has(normalizeSkillId(item?.id)))
    : [];
  const installedIds = new Set(installed.map((item) => normalizeSkillId(item?.id)));
  const failedIds = new Set(failed.map((item) => normalizeSkillId(item?.id)));
  const hasPendingSkills = skills.some((skill) => !installedIds.has(skill) && !failedIds.has(skill));

  return {
    ...existing,
    source: existing.source || AUTOHAND_SKILLS_REGISTRY_URL,
    requested: skills,
    installed,
    failed,
    status: hasPendingSkills ? "pending" : failed.length ? "partial" : "installed",
  };
}

function refreshedProfileFilesForAgent(agent) {
  return buildAgentProfileFiles(agent).map((file) =>
    file.source === "generated"
      ? {
          ...file,
          content: defaultProfileFileContent(agent, file.section),
        }
      : file
  );
}

function AvatarPicker({ value, onChange, options = builtInAvatarOptions }) {
  const selectedOption = options.find((option) => option.src === value);
  const orderedOptions = [];
  const seenSources = new Set();

  for (const option of [
    selectedOption,
    ...options.filter((item) => item.id.startsWith("nz-riso-set")),
    ...options,
  ]) {
    if (!option || seenSources.has(option.src)) continue;
    seenSources.add(option.src);
    orderedOptions.push(option);
  }

  return (
    <div className="rounded-md border bg-card/70 p-3">
      <div
        role="radiogroup"
        aria-label="Built-in avatars"
        className="grid max-h-56 gap-2 overflow-y-auto pr-1"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))" }}
      >
        {orderedOptions.map((option) => {
          const selected = value === option.src;
          return (
            <button
              key={`${option.id}-${option.src}`}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Use ${option.label}`}
              className={cn(
                "relative grid size-12 place-items-center rounded-full border bg-muted/40 p-0 transition-[border-color,box-shadow,transform]",
                "hover:-translate-y-0.5 hover:border-foreground/70 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35",
                selected && "border-primary shadow-[0_0_0_2px_var(--primary)]"
              )}
              onClick={() => onChange(option.src)}
            >
              <img src={option.src} alt="" loading="lazy" className="size-full rounded-full object-cover" />
              {selected ? (
                <span className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full border border-background bg-primary text-primary-foreground">
                  <CheckCircle2 className="size-3" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildCustomRoleInstructions(templateDraft) {
  const mcpItems = parseDelimitedList(templateDraft.mcpText);
  const hasProfileFiles = profileFilesFromDraft(templateDraft).length > 0;

  return [
    `Act as ${templateDraft.title.trim()}.`,
    templateDraft.description.trim(),
    hasProfileFiles
      ? "Use this squad member's saved profile Markdown files for identity, work style, workflow, and memory details when deeper role context is relevant."
      : "",
    mcpItems.length ? `Preferred MCP servers and tools:\n${mcpItems.map((item) => `- ${item}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function CreateAgent({ onCreate, onCancel, defaultWorkspace, workspaceRoot }) {
  const [customTemplates, setCustomTemplates] = useState([]);
  const [customTemplateDialogOpen, setCustomTemplateDialogOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const availableTemplates = useMemo(() => [...roleTemplates, ...customTemplates], [customTemplates]);
  const selectedTemplate = availableTemplates.find((item) => item.id === templateId);
  const template = selectedTemplate || roleTemplates[0] || CUSTOM_ROLE_TEMPLATE;
  const runtimeShell = useMemo(() => ({ workspaceRoot, defaultWorkspace }), [workspaceRoot, defaultWorkspace]);
  const nameInputRef = useRef(null);
  const namesByTemplateRef = useRef({});
  const [avatarError, setAvatarError] = useState("");
  const [draft, setDraft] = useState(() => ({
    employeeType: template.id,
    name: "",
    role: template.title,
    workspace: defaultWorkspace,
    description: template.description,
    instructions: template.starter,
    skills: normalizeSkillList(template.skills),
    skillSource: template.skillSource || AUTOHAND_SKILLS_REGISTRY_URL,
    avatar: "",
    profileFiles: normalizeProfileFiles(template.profileFiles),
  }));

  useEffect(() => {
    if (!selectedTemplate) return;

    setDraft((current) => ({
      ...current,
      employeeType: selectedTemplate.id,
      name: namesByTemplateRef.current[selectedTemplate.id] ?? (current.employeeType === selectedTemplate.id ? current.name : ""),
      role: selectedTemplate.title,
      description: selectedTemplate.description,
      instructions: selectedTemplate.starter,
      skills: normalizeSkillList(selectedTemplate.skills),
      skillSource: selectedTemplate.skillSource || AUTOHAND_SKILLS_REGISTRY_URL,
      avatar: selectedTemplate.avatar || current.avatar,
      profileFiles: normalizeProfileFiles(selectedTemplate.profileFiles),
    }));
  }, [selectedTemplate]);

  useEffect(() => {
    if (!templateId) return;
    const focusFrame = requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, [templateId]);

  useEffect(() => {
    if ((!draft.workspace || isBlockedWorkspace(draft.workspace, runtimeShell)) && defaultWorkspace) {
      setDraft((current) => ({ ...current, workspace: defaultWorkspace }));
    }
  }, [defaultWorkspace, draft.workspace, runtimeShell]);

  const isCustomRole = Boolean(selectedTemplate?.id.startsWith(CUSTOM_ROLE_TEMPLATE.id));
  const isValid = Boolean(selectedTemplate && draft.name.trim() && draft.description.trim() && draft.instructions.trim());

  function toggleTemplate(id) {
    setTemplateId((current) => (current === id ? "" : id));
    setAvatarError("");
  }

  function selectCustomRole() {
    setCustomTemplateDialogOpen(true);
    setAvatarError("");
  }

  function createCustomTemplate(templateDraft) {
    const id = `custom-role-${Date.now().toString(36)}`;
    const description = templateDraft.description.trim();
    const customTemplate = {
      id,
      title: templateDraft.title.trim(),
      label: "Custom",
      accent: "green",
      description,
      starter: buildCustomRoleInstructions(templateDraft),
      skills: normalizeSkillList(parseDelimitedList(templateDraft.skillsText)),
      skillSource: AUTOHAND_SKILLS_REGISTRY_URL,
      avatar: templateDraft.avatar,
      profileFiles: profileFilesFromDraft(templateDraft),
    };
    setCustomTemplates((current) => [...current, customTemplate]);
    namesByTemplateRef.current = { ...namesByTemplateRef.current, [id]: "" };
    setTemplateId(id);
    setDraft((current) => ({
      ...current,
      employeeType: id,
      name: "",
      role: customTemplate.title,
      description: customTemplate.description,
      instructions: customTemplate.starter,
      skills: normalizeSkillList(customTemplate.skills),
      skillSource: customTemplate.skillSource,
      avatar: customTemplate.avatar || current.avatar,
      profileFiles: normalizeProfileFiles(customTemplate.profileFiles),
    }));
  }

  function uploadAvatar(event) {
    const file = event.target.files?.[0];
    readAvatarFile(file, (avatar) => setDraft((current) => ({ ...current, avatar })), setAvatarError, event.target);
  }

  return (
    <div className="min-h-[calc(100svh-4rem)] bg-background lg:min-h-screen">
      <form
        className="mx-auto flex w-full max-w-[1120px] flex-col px-5 py-10 sm:px-8 lg:px-10 lg:py-20"
        onSubmit={(event) => {
          event.preventDefault();
          if (isValid) onCreate(draft);
        }}
      >
        <div className="mb-9 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">New Squad member</h1>
          <Button type="button" variant="ghost" className="lg:hidden" onClick={onCancel}>
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
        </div>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <FieldLabel className="text-sm font-medium text-muted-foreground">Select a role</FieldLabel>
            <Button
              type="button"
              variant="ghost"
              className={cn("h-8 px-2 text-sm text-muted-foreground", isCustomRole && "text-foreground")}
              onClick={selectCustomRole}
            >
              Custom Role
              <ChevronRight data-icon="inline-end" />
            </Button>
          </div>

          <div role="group" aria-label="Enable squad roles" className="grid items-start gap-3 lg:grid-cols-2">
            {availableTemplates.map((role) => {
              const selected = templateId === role.id;
              return (
                <article
                  key={role.id}
                  className={cn(
                    "overflow-hidden rounded-md border bg-card shadow-xs transition-[border-color,box-shadow,background-color]",
                    selected
                      ? "border-[#171717] ring-1 ring-[#171717] dark:border-foreground dark:ring-foreground"
                      : "border-border"
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={selected}
                    className={cn(
                      "grid min-h-[92px] w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-left transition-colors",
                      "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                    )}
                    onClick={() => toggleTemplate(role.id)}
                  >
                    <RoleAvatar roleId={role.id} src={role.avatar} alt={`${role.title} avatar`} />
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold">{role.title}</span>
                      <span className="mt-1 block truncate text-sm text-muted-foreground">{role.description}</span>
                    </span>
                    <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <span className={cn("hidden sm:inline", selected && "text-foreground")}>
                        {selected ? "Enabled" : "Off"}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "relative inline-flex h-[22px] w-10 shrink-0 rounded-full border transition-colors",
                          selected ? "border-primary bg-primary" : "border-input bg-input dark:bg-input/80"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-background shadow-sm transition-transform dark:bg-foreground",
                            selected ? "translate-x-[18px] dark:bg-primary-foreground" : "translate-x-[2px]"
                          )}
                        />
                      </span>
                    </span>
                  </button>

                  {selected ? (
                    <div className="border-t bg-background/40 px-4 pb-4 pt-3">
                      <Field className="gap-2">
                        <FieldLabel htmlFor={`role-name-${role.id}`} className="text-sm">
                          Name <span className="text-primary">*</span>
                        </FieldLabel>
                        <Input
                          id={`role-name-${role.id}`}
                          ref={nameInputRef}
                          value={draft.name}
                          onChange={(event) => {
                            const nextName = event.target.value;
                            setDraft((current) => ({ ...current, name: nextName }));
                            namesByTemplateRef.current = { ...namesByTemplateRef.current, [role.id]: nextName };
                          }}
                          placeholder="Enter squad member name"
                          className="h-10 bg-card"
                        />
                      </Field>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        {selectedTemplate ? (
          <FieldGroup className="mt-8 gap-7">
            <Field>
              <FieldLabel>
                Profile Avatar <span className="text-primary">*</span>
              </FieldLabel>
              <div className="flex flex-wrap items-center gap-4">
                <RoleAvatar roleId={template.id} src={draft.avatar} alt={`${draft.name || draft.role} avatar`} size="large" />
                <input id="member-avatar-upload" type="file" accept={AVATAR_UPLOAD_ACCEPT} className="sr-only" onChange={uploadAvatar} />
                <Button asChild variant="outline">
                  <label htmlFor="member-avatar-upload" className="cursor-pointer">
                    Upload Avatar
                  </label>
                </Button>
                <span className="text-sm text-muted-foreground">PNG / JPG / WebP, max 2 MB</span>
              </div>
              <AvatarPicker value={draft.avatar} onChange={(avatar) => setDraft((current) => ({ ...current, avatar }))} />
              {avatarError ? <FieldDescription className="text-destructive">{avatarError}</FieldDescription> : null}
            </Field>

            <Field>
              <FieldLabel>Bio</FieldLabel>
              <Textarea
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="Describe this squad member's responsibilities, strengths, and working style."
                className="min-h-[148px] resize-y bg-card leading-6"
              />
            </Field>

            <Field>
              <FieldLabel>Autohand Skills</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {draft.skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="rounded-md border border-border/75 bg-card font-mono text-[11px]">
                    {skill}
                  </Badge>
                ))}
              </div>
              <FieldDescription>Installed from skilled.autohand.ai into this squad member's isolated Autohand home.</FieldDescription>
            </Field>
          </FieldGroup>
        ) : null}

        <div className="mt-16 flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={!isValid}
            className="bg-[#181818] text-white hover:bg-[#2a2a2a] dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
          >
            Save & Enable
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
      <CustomRoleTemplateDialog
        open={customTemplateDialogOpen}
        onOpenChange={setCustomTemplateDialogOpen}
        onCreate={createCustomTemplate}
      />
    </div>
  );
}

function CustomRoleTemplateDialog({ open, onOpenChange, onCreate }) {
  const [draft, setDraft] = useState(createEmptyCustomRoleDraft);
  const [avatarError, setAvatarError] = useState("");
  const [markdownError, setMarkdownError] = useState("");
  const skillCount = parseDelimitedList(draft.skillsText).length;
  const mcpCount = parseDelimitedList(draft.mcpText).length;
  const isValid = draft.title.trim() && draft.description.trim();

  useEffect(() => {
    if (!open) return;
    setDraft(createEmptyCustomRoleDraft());
    setAvatarError("");
    setMarkdownError("");
  }, [open]);

  function updateDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateSection(sectionId, value) {
    setDraft((current) => ({
      ...current,
      sections: { ...current.sections, [sectionId]: value },
    }));
  }

  function updateSectionFileName(sectionId, fileName) {
    setDraft((current) => ({
      ...current,
      sectionFileNames: { ...(current.sectionFileNames || {}), [sectionId]: fileName },
    }));
  }

  function uploadAvatar(event) {
    const file = event.target.files?.[0];
    readAvatarFile(file, (avatar) => updateDraft({ avatar }), setAvatarError, event.target);
  }

  function uploadMarkdown(sectionId, event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const isMarkdown = file.name.endsWith(".md") || file.type === "text/markdown" || file.type === "text/plain";
    if (!isMarkdown) {
      setMarkdownError("Upload a Markdown file.");
      event.target.value = "";
      return;
    }

    if (file.size > 512 * 1024) {
      setMarkdownError("Markdown files must be 512 KB or smaller.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setMarkdownError("");
      updateSection(sectionId, String(reader.result || ""));
      updateSectionFileName(sectionId, file.name);
      event.target.value = "";
    };
    reader.onerror = () => setMarkdownError("Markdown file could not be read.");
    reader.readAsText(file);
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!isValid) return;
    onCreate(draft);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-none border-border bg-background p-0 sm:max-w-[980px] sm:rounded-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="border-b px-6 py-5 text-left sm:px-8">
            <DialogTitle className="text-2xl">Create Role Template</DialogTitle>
            <DialogDescription className="max-w-3xl text-base">
              If Autohand Squad roles do not meet your needs, you can define your own role.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-7 px-6 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-7">
              <Field>
                <FieldLabel>
                  Template Name <span className="text-primary">*</span>
                </FieldLabel>
                <Input
                  value={draft.title}
                  onChange={(event) => updateDraft({ title: event.target.value })}
                  placeholder="Example: Data Analyst, Fund Manager"
                  className="h-12 bg-card text-base"
                  autoFocus
                />
              </Field>

              <Field>
                <FieldLabel>
                  One-line Template Positioning <span className="text-primary">*</span>
                </FieldLabel>
                <Textarea
                  value={draft.description}
                  onChange={(event) => updateDraft({ description: event.target.value })}
                  placeholder="Shown on the role card. 30-80 characters is best; answer who it is and what problems it solves."
                  className="min-h-[118px] resize-y bg-card text-base leading-6"
                />
              </Field>
            </div>

            <Field className="lg:pt-1">
              <FieldLabel>Avatar</FieldLabel>
              <div className="mt-2 flex items-center gap-4">
                <RoleAvatar
                  roleId={CUSTOM_ROLE_TEMPLATE.id}
                  src={draft.avatar}
                  alt={`${draft.title || "Custom role"} avatar`}
                  size="large"
                />
                <input id="custom-role-avatar-upload" type="file" accept={AVATAR_UPLOAD_ACCEPT} className="sr-only" onChange={uploadAvatar} />
                <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
                  <label htmlFor="custom-role-avatar-upload" className="cursor-pointer">
                    Upload Avatar
                  </label>
                </Button>
              </div>
              <div className="mt-4">
                <AvatarPicker value={draft.avatar} onChange={(avatar) => updateDraft({ avatar })} />
              </div>
              {avatarError ? <FieldDescription className="text-destructive">{avatarError}</FieldDescription> : null}
            </Field>
          </div>

          <div className="px-6 pb-6 sm:px-8">
            <Tabs value={draft.mode} onValueChange={(mode) => updateDraft({ mode })}>
              <TabsList>
                <TabsTrigger value="upload">Upload Markdown</TabsTrigger>
                <TabsTrigger value="manual">Manual</TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="mt-5 space-y-4">
                {CUSTOM_ROLE_SECTIONS.map((section) => {
                  const body = draft.sections[section.id];
                  const loadedName = draft.sectionFileNames?.[section.id];
                  return (
                    <section key={section.id} className="rounded-md border bg-card p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-muted-foreground">{section.title}</h3>
                        <Badge variant="secondary" className="border border-blue-500/50 bg-blue-500/10 text-blue-300">
                          {section.badge}
                        </Badge>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <input
                          id={`custom-role-${section.id}-upload`}
                          type="file"
                          accept=".md,text/markdown,text/plain"
                          className="sr-only"
                          onChange={(event) => uploadMarkdown(section.id, event)}
                        />
                        <Button asChild variant="outline">
                          <label htmlFor={`custom-role-${section.id}-upload`} className="cursor-pointer">
                            <Upload data-icon="inline-start" />
                            {section.uploadLabel}
                          </label>
                        </Button>
                        {body ? (
                          <span className="text-sm text-muted-foreground">
                            Loaded {loadedName || section.fileName} ({body.length.toLocaleString()} characters)
                          </span>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
                {markdownError ? <p className="text-sm text-destructive">{markdownError}</p> : null}
              </TabsContent>

              <TabsContent value="manual" className="mt-5 space-y-4">
                {CUSTOM_ROLE_SECTIONS.map((section) => (
                  <Field key={section.id} className="rounded-md border bg-card p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <FieldLabel className="text-base text-muted-foreground">{section.title}</FieldLabel>
                      <Badge variant="secondary" className="border border-blue-500/50 bg-blue-500/10 text-blue-300">
                        {section.badge}
                      </Badge>
                    </div>
                    <Textarea
                      value={draft.sections[section.id]}
                      onChange={(event) => updateSection(section.id, event.target.value)}
                      placeholder={section.placeholder}
                      className="mt-3 min-h-[128px] resize-y bg-background leading-6"
                    />
                  </Field>
                ))}
              </TabsContent>
            </Tabs>

            <section className="mt-5 rounded-md border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-muted-foreground">Skills ({skillCount})</h3>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => document.getElementById("custom-role-skills")?.focus()}>
                    <Upload data-icon="inline-start" />
                    Upload Zip package
                  </Button>
                  <Button type="button" variant="outline" onClick={() => document.getElementById("custom-role-skills")?.focus()}>
                    <Plus data-icon="inline-start" />
                    Choose from marketplace
                  </Button>
                </div>
              </div>
              <Textarea
                id="custom-role-skills"
                value={draft.skillsText}
                onChange={(event) => updateDraft({ skillsText: event.target.value })}
                placeholder="Add skill slugs, one per line."
                className="mt-4 min-h-[92px] resize-y bg-background"
              />
            </section>

            <section className="mt-5 rounded-md border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-muted-foreground">MCP ({mcpCount})</h3>
                <Button type="button" variant="outline" onClick={() => document.getElementById("custom-role-mcp")?.focus()}>
                  <Plus data-icon="inline-start" />
                  Add MCP
                </Button>
              </div>
              <Textarea
                id="custom-role-mcp"
                value={draft.mcpText}
                onChange={(event) => updateDraft({ mcpText: event.target.value })}
                placeholder="Add MCP servers or tools, one per line."
                className="mt-4 min-h-[80px] resize-y bg-background"
              />
            </section>
          </div>

          <DialogFooter className="sticky bottom-0 border-t bg-background/95 px-6 py-4 backdrop-blur sm:px-8">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              Create Template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AgentProfileEditDialog({ agent, open, onOpenChange, onSave }) {
  const [draft, setDraft] = useState(() => profileEditDraftFromAgent(agent));
  const [avatarError, setAvatarError] = useState("");
  const skillCount = parseDelimitedList(draft.skillsText).length;
  const isValid = Boolean(draft.name.trim());

  useEffect(() => {
    if (!open) return;
    setDraft(profileEditDraftFromAgent(agent));
    setAvatarError("");
  }, [agent, open]);

  function updateDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function uploadAvatar(event) {
    const file = event.target.files?.[0];
    readAvatarFile(file, (avatar) => updateDraft({ avatar }), setAvatarError, event.target);
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!isValid) return;

    const skills = normalizeSkillList(parseDelimitedList(draft.skillsText));
    const timestamp = new Date().toISOString();
    const nextAgent = {
      ...agent,
      name: draft.name.trim(),
      role: draft.role.trim() || agent.role,
      description: draft.description.trim(),
      instructions: draft.instructions.trim(),
      avatar: draft.avatar,
      skills,
      skillInstall: skillInstallFromEditedSkills(agent, skills),
      updatedAt: timestamp,
    };

    onSave({
      name: nextAgent.name,
      role: nextAgent.role,
      description: nextAgent.description,
      instructions: nextAgent.instructions,
      avatar: nextAgent.avatar,
      skills: nextAgent.skills,
      skillInstall: nextAgent.skillInstall,
      profileFiles: refreshedProfileFilesForAgent(nextAgent),
      updatedAt: timestamp,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto rounded-none border-border bg-background p-0 sm:max-w-[980px] sm:rounded-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="border-b px-6 py-5 text-left sm:px-8">
            <DialogTitle className="text-2xl">Edit Profile</DialogTitle>
            <DialogDescription className="max-w-3xl text-base">
              Update {agent?.name || "this squad member"}'s identity, avatar, and Autohand skills.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-7 px-6 py-6 sm:px-8 lg:grid-cols-[280px_minmax(0,1fr)]">
            <section className="space-y-4">
              <Field>
                <FieldLabel>Profile Avatar</FieldLabel>
                <div className="flex items-center gap-4">
                  <RoleAvatar
                    roleId={agent?.employeeType || "custom-role"}
                    src={draft.avatar}
                    alt={`${draft.name || agent?.name || "Squad member"} avatar`}
                    size="large"
                  />
                  <input
                    id={`profile-avatar-upload-${agent?.id || "member"}`}
                    type="file"
                    accept={AVATAR_UPLOAD_ACCEPT}
                    className="sr-only"
                    onChange={uploadAvatar}
                  />
                  <Button asChild variant="outline">
                    <label htmlFor={`profile-avatar-upload-${agent?.id || "member"}`} className="cursor-pointer">
                      Upload Avatar
                    </label>
                  </Button>
                </div>
                <FieldDescription>PNG / JPG / WebP, max 2 MB</FieldDescription>
                {avatarError ? <FieldDescription className="text-destructive">{avatarError}</FieldDescription> : null}
              </Field>

              <AvatarPicker value={draft.avatar} onChange={(avatar) => updateDraft({ avatar })} />
            </section>

            <div className="grid gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel>
                    Name <span className="text-primary">*</span>
                  </FieldLabel>
                  <Input
                    value={draft.name}
                    onChange={(event) => updateDraft({ name: event.target.value })}
                    placeholder="Enter squad member name"
                    className="h-11 bg-card"
                    autoFocus
                  />
                </Field>

                <Field>
                  <FieldLabel>Role</FieldLabel>
                  <Input
                    value={draft.role}
                    onChange={(event) => updateDraft({ role: event.target.value })}
                    placeholder="Example: QA Engineer"
                    className="h-11 bg-card"
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel>Bio</FieldLabel>
                <Textarea
                  value={draft.description}
                  onChange={(event) => updateDraft({ description: event.target.value })}
                  placeholder="Describe this squad member's responsibilities, strengths, and working style."
                  className="min-h-[118px] resize-y bg-card leading-6"
                />
              </Field>

              <Field>
                <FieldLabel>Operating Instructions</FieldLabel>
                <Textarea
                  value={draft.instructions}
                  onChange={(event) => updateDraft({ instructions: event.target.value })}
                  placeholder="Describe how this squad member should work, communicate, and verify results."
                  className="min-h-[118px] resize-y bg-card leading-6"
                />
              </Field>

              <Field>
                <FieldLabel>Autohand Skills ({skillCount})</FieldLabel>
                <Textarea
                  value={draft.skillsText}
                  onChange={(event) => updateDraft({ skillsText: event.target.value })}
                  placeholder="Add skill slugs, one per line."
                  className="min-h-[112px] resize-y bg-card font-mono text-sm leading-6"
                />
                <FieldDescription>Installed from skilled.autohand.ai into this squad member's isolated Autohand home.</FieldDescription>
              </Field>
            </div>
          </div>

          <DialogFooter className="sticky bottom-0 border-t bg-background/95 px-6 py-4 backdrop-blur sm:px-8">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              Save Profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SquadMemberPage(props) {
  const workRecordTabBySection = {
    home: "timeline",
    task: "tasks",
  };

  if (props.section === "triggers") {
    return <AutomationsPage {...props} />;
  }

  if (workRecordTabBySection[props.section]) {
    return <Profile {...props} initialWorkRecordTab={workRecordTabBySection[props.section]} />;
  }

  return <SquadMemberSectionPage {...props} />;
}

function AutomationsPage({
  agent,
  automations,
  setAutomations,
  runtime,
  workspaces,
  route,
  navigate,
  runAutomation,
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState(null);
  const automationId = memberAutomationIdFromRoute(route);
  const selectedAutomation = automations.find((automation) => automation.id === automationId);
  const defaultWorkspace = getAgentWorkspace(agent, runtime, workspaces);

  function openCreate() {
    setEditingAutomation(null);
    setFormOpen(true);
  }

  function openEdit(automation) {
    setEditingAutomation(automation);
    setFormOpen(true);
  }

  function saveAutomation(draft) {
    const saved = buildAutomationFromDraft(draft, editingAutomation, agent, defaultWorkspace);
    setAutomations((current) => {
      const exists = current.some((item) => item.id === saved.id);
      if (exists) {
        return current.map((item) => (item.id === saved.id ? saved : item));
      }
      return [saved, ...current];
    });
    setFormOpen(false);
    setEditingAutomation(null);
    if (automationId) {
      navigate(automationDetailPath(agent.id, saved.id));
    }
  }

  function deleteAutomation(automation) {
    setAutomations((current) => current.filter((item) => item.id !== automation.id));
    if (automationId) {
      navigate(automationListPath(agent.id));
    }
  }

  function toggleAutomation(automation) {
    const timestamp = new Date().toISOString();
    setAutomations((current) =>
      current.map((item) =>
        item.id === automation.id
          ? {
              ...item,
              status: item.status === "active" ? "paused" : "active",
              updatedAt: timestamp,
            }
          : item
      )
    );
  }

  if (automationId && selectedAutomation) {
    return (
      <AutomationDetailView
        agent={agent}
        automation={selectedAutomation}
        runtime={runtime}
        workspaces={workspaces}
        defaultWorkspace={defaultWorkspace}
        navigate={navigate}
        onEdit={openEdit}
        onDelete={deleteAutomation}
        onToggle={toggleAutomation}
        runAutomation={runAutomation}
        locale={locale}
        copy={copy}
        formOpen={formOpen}
        setFormOpen={setFormOpen}
        editingAutomation={editingAutomation}
        setEditingAutomation={setEditingAutomation}
        onSave={saveAutomation}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-4xl font-semibold tracking-normal">{copy.automations}</h1>
            <p className="mt-3 max-w-2xl text-base text-muted-foreground">
              Create automations that can be triggered on schedule or manually anytime.
            </p>
          </div>
          <Button className="w-fit" onClick={openCreate}>
            <Plus data-icon="inline-start" />
            New
          </Button>
        </div>

        {automations.length ? (
          <Alert className="border-blue-500/60 bg-blue-950/25 text-blue-100 dark:bg-blue-950/25">
            <InfoIcon />
            <AlertDescription>Local automations only run while your computer is awake.</AlertDescription>
          </Alert>
        ) : null}

        {automations.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {automations.map((automation) => (
              <AutomationCard
                key={automation.id}
                automation={automation}
                agent={agent}
                navigate={navigate}
                onEdit={openEdit}
                onDelete={deleteAutomation}
                onToggle={toggleAutomation}
                locale={locale}
              />
            ))}
          </div>
        ) : (
          <AutomationEmptyState onCreate={openCreate} />
        )}
      </div>

      <AutomationFormDialog
        agent={agent}
        automation={editingAutomation}
        defaultWorkspace={defaultWorkspace}
        runtime={runtime}
        workspaces={workspaces}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingAutomation(null);
        }}
        onSave={saveAutomation}
      />
    </div>
  );
}

function InfoIcon() {
  return <CircleDot className="size-4 text-blue-400" />;
}

function AutomationEmptyState({ onCreate }) {
  return (
    <div className="grid min-h-[460px] place-items-center">
      <div className="flex max-w-md flex-col items-center text-center">
        <button
          type="button"
          className="grid size-20 place-items-center rounded-md border border-dashed border-border/90 text-muted-foreground transition-colors hover:border-primary/70 hover:text-primary"
          onClick={onCreate}
          aria-label="Create automation"
        >
          <Clock3 className="size-8" />
        </button>
        <h2 className="mt-7 text-xl font-semibold">No automations yet</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Create an automation to run squad members on a schedule, webhook, or API call.
        </p>
      </div>
    </div>
  );
}

function AutomationCard({ automation, agent, navigate, onEdit, onDelete, onToggle, locale = DEFAULT_LOCALE }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <section className="relative w-full max-w-xl rounded-md border border-border/85 bg-card/55 p-5 shadow-none">
      <button
        type="button"
        className="block min-w-0 text-left outline-none transition-colors hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40"
        onClick={() => navigate(automationDetailPath(agent.id, automation.id))}
      >
        <span className="block truncate text-base font-semibold">{automation.name}</span>
        <span className="mt-3 block text-sm text-muted-foreground">{automationScheduleLabel(automation, locale)}</span>
      </button>
      <div className="my-5 border-t border-dashed border-border/80" />
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Switch checked={automation.status === "active"} onCheckedChange={() => onToggle(automation)} />
          <span className="truncate text-sm text-muted-foreground">Next: {automationNextRunLabel(automation, locale)}</span>
        </div>
        <div className="relative">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Automation actions for ${automation.name}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <Ellipsis />
          </Button>
          {menuOpen ? (
            <AutomationMenu
              onEdit={() => {
                setMenuOpen(false);
                onEdit(automation);
              }}
              onDelete={() => {
                setMenuOpen(false);
                onDelete(automation);
              }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AutomationMenu({ onEdit, onDelete }) {
  return (
    <div className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-md border border-border/85 bg-popover p-1 shadow-xl shadow-black/30">
      <button
        type="button"
        className="flex h-10 w-full items-center gap-3 rounded-[6px] px-3 text-sm transition-colors hover:bg-accent"
        onClick={onEdit}
      >
        <PencilLine className="size-4" />
        Edit
      </button>
      <button
        type="button"
        className="flex h-10 w-full items-center gap-3 rounded-[6px] px-3 text-sm text-destructive transition-colors hover:bg-destructive/10"
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
        Delete
      </button>
    </div>
  );
}

function AutomationDetailView({
  agent,
  automation,
  runtime,
  workspaces,
  defaultWorkspace,
  navigate,
  onEdit,
  onDelete,
  onToggle,
  runAutomation,
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  formOpen,
  setFormOpen,
  editingAutomation,
  setEditingAutomation,
  onSave,
}) {
  const [runStarting, setRunStarting] = useState(false);
  const history = Array.isArray(automation.runHistory) ? automation.runHistory : [];

  async function runNow() {
    setRunStarting(true);
    try {
      await runAutomation(automation);
    } finally {
      setRunStarting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex h-14 items-center gap-3 border-b border-border/75 bg-background/92 px-5 text-sm backdrop-blur-xl sm:px-6">
        <button
          type="button"
          className="text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => navigate(automationListPath(agent.id))}
        >
          Automations
        </button>
        <ChevronRight className="size-4 text-muted-foreground" />
        <span className="font-semibold">{automation.name}</span>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-normal">{automation.name}</h1>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <AutomationStatusPill status={automation.status} />
              <span>Created {formatAutomationDate(automation.createdAt, locale)}</span>
              <span>Next run {automationNextRunLabel(automation, locale)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Edit automation" onClick={() => onEdit(automation)}>
                  <PencilLine />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Delete automation" onClick={() => onDelete(automation)}>
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={automation.status === "active" ? "Pause automation" : "Resume automation"} onClick={() => onToggle(automation)}>
                  <PauseCircle />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{automation.status === "active" ? "Pause" : "Resume"}</TooltipContent>
            </Tooltip>
            <Button onClick={runNow} disabled={runStarting}>
              {runStarting ? <Spinner /> : <Play data-icon="inline-start" />}
              {copy.runNow}
            </Button>
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(320px,0.7fr)]">
          <div className="flex flex-col gap-8">
            <AutomationDetailField label="Task Description" value={automation.description || automation.prompt || "No description"} />
            <AutomationDetailField label="Model" value={automation.model || "auto"} />
            <AutomationDetailField
              label={automation.workspaceSource === "project" ? "Project" : "Local Directory"}
              value={automation.workspace || defaultWorkspace || "No workspace selected"}
              icon={Folder}
              accent
            />
            <AutomationDetailField
              label="Automations"
              value={automationScheduleLabel(automation, locale)}
              icon={automation.triggerType === "event" ? GitBranch : automation.triggerType === "webhook" ? Webhook : Clock3}
            />
            {automation.triggerType === "event" ? (
              <AutomationDetailField label="Linked Repository" value={automation.linkedRepository || "No linked Git repository"} icon={FolderGit2} />
            ) : null}
            {automation.triggerType === "webhook" ? (
              <AutomationDetailField label="Webhook Endpoint" value={automation.webhookPath} icon={Webhook} />
            ) : null}
          </div>

          <aside className="rounded-md border border-border/85 bg-card/55 p-5">
            <div className="text-sm font-semibold uppercase tracking-normal text-muted-foreground">Total Run Count</div>
            <div className="mt-5 text-2xl font-semibold">{formatLocalizedNumber(automation.runCount || 0, locale)} runs</div>
            <p className="mt-2 text-sm text-muted-foreground">Since creation</p>
          </aside>
        </section>

        <section>
          <h2 className="text-xl font-semibold">
            Run History <span className="text-muted-foreground">({formatLocalizedNumber(history.length, locale)} total)</span>
          </h2>
          <div className="mt-5 overflow-hidden rounded-md border border-border/80 bg-card/55">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">#</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length ? (
                  history.map((run, index) => (
                    <TableRow key={run.id || `${run.time}-${index}`}>
                      <TableCell>{history.length - index}</TableCell>
                      <TableCell>{formatRecordDate(run.time, locale, copy)}</TableCell>
                      <TableCell>{run.summary || "Automation run started."}</TableCell>
                      <TableCell>{run.source || "manual"}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                      No runs yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>

      <AutomationFormDialog
        agent={agent}
        automation={editingAutomation}
        defaultWorkspace={defaultWorkspace}
        runtime={runtime}
        workspaces={workspaces}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingAutomation(null);
        }}
        onSave={onSave}
      />
    </div>
  );
}

function AutomationStatusPill({ status }) {
  const active = status === "active";
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-4 text-sm font-medium",
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border bg-muted/45 text-muted-foreground"
      )}
    >
      {active ? "Active" : "Paused"}
    </span>
  );
}

function AutomationDetailField({ label, value, icon: Icon, accent = false }) {
  return (
    <div>
      <div className="text-sm font-semibold uppercase tracking-normal text-muted-foreground">{label}</div>
      <div className={cn("mt-4 flex min-w-0 items-center gap-3 text-lg", accent && "text-primary")}>
        {Icon ? <Icon className="size-5 shrink-0 text-muted-foreground" /> : null}
        <span className="min-w-0 break-words">{value}</span>
      </div>
    </div>
  );
}

function AutomationFormDialog({ agent, automation, defaultWorkspace, runtime, workspaces, open, onOpenChange, onSave }) {
  const [draft, setDraft] = useState(() => automationDraftFrom(automation, agent, defaultWorkspace));
  const workspaceChoices = workspaceOptions(workspaces, draft.workspace, runtime);
  const projectChoices = normalizeAgentProjects(agent?.projects, agent?.workspace, workspaces);
  const descriptionLength = draft.description.length;
  const isValid = draft.name.trim() && draft.description.trim() && draft.workspace.trim();

  useEffect(() => {
    if (open) {
      setDraft(automationDraftFrom(automation, agent, defaultWorkspace));
    }
  }, [agent, automation, defaultWorkspace, open]);

  function updateDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function submit(event) {
    event.preventDefault();
    if (!isValid) return;
    onSave(draft);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="Close" className="max-h-[88svh] overflow-hidden rounded-md border-border bg-background p-0 sm:max-w-[760px]">
        <DialogHeader className="sr-only">
          <DialogTitle>{automation ? "Edit Automation" : "New Automation"}</DialogTitle>
          <DialogDescription>Configure a local Autohand automation.</DialogDescription>
        </DialogHeader>

        <form className="flex max-h-[88svh] flex-col" onSubmit={submit}>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <h2 className="text-xl font-semibold tracking-normal">{automation ? "Edit Automation" : "New Automation"}</h2>

            <div className="mt-5 grid gap-5">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-muted-foreground">Name <span className="text-primary">*</span></span>
                <Input
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  placeholder="Give this automation a name"
                  className="h-10 text-sm"
                />
              </label>

              <section className="grid gap-3">
                <div className="text-sm font-semibold text-muted-foreground">Workspace source <span className="text-primary">*</span></div>
                <ToggleGroup
                  type="single"
                  value={draft.workspaceSource}
                  onValueChange={(value) => {
                    if (!value) return;
                    const nextWorkspace = value === "project" ? projectChoices[0]?.path || draft.workspace : draft.workspace || defaultWorkspace;
                    updateDraft({ workspaceSource: value, workspace: nextWorkspace || "" });
                  }}
                  variant="outline"
                  className="w-fit gap-1 rounded-md bg-muted p-1"
                  spacing={1}
                >
                  <ToggleGroupItem value="local" className="h-8 px-3 text-sm">Local Directory</ToggleGroupItem>
                  <ToggleGroupItem value="project" className="h-8 px-3 text-sm">Project</ToggleGroupItem>
                </ToggleGroup>

                <div className="rounded-md bg-muted/70 p-3">
                  {draft.workspaceSource === "project" ? (
                    <Select value={draft.workspace} onValueChange={(workspace) => updateDraft({ workspace })}>
                      <SelectTrigger className="h-10 w-full bg-background text-sm">
                        <FolderGit2 className="size-4 text-muted-foreground" />
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Projects</SelectLabel>
                          {(projectChoices.length ? projectChoices : workspaceChoices).map((item) => (
                            <SelectItem key={item.path} value={item.path}>
                              {item.label || workspaceLabel(item.path, workspaces)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2">
                      <Input
                        value={draft.workspace}
                        onChange={(event) => updateDraft({ workspace: event.target.value })}
                        placeholder={defaultWorkspace || "Choose a local directory"}
                        className="h-10 bg-background text-sm"
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-10 w-10"
                            onClick={() => updateDraft({ workspace: defaultWorkspace || workspaceChoices[0]?.path || draft.workspace })}
                            aria-label="Use default directory"
                          >
                            <Folder />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Use default directory</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
              </section>

              <section className="grid gap-2">
                <label className="text-sm font-semibold text-muted-foreground" htmlFor="automation-description">
                  Automation Description <span className="text-primary">*</span>
                </label>
                <div className="overflow-hidden rounded-md border border-input bg-background">
                  <Textarea
                    id="automation-description"
                    value={draft.description}
                    onChange={(event) => updateDraft({ description: event.target.value.slice(0, 10000) })}
                    placeholder="Tell this squad member what to do when the automation runs."
                    className="min-h-[136px] resize-y border-0 bg-transparent p-3 text-sm shadow-none focus-visible:ring-0"
                  />
                  <div className="flex flex-col gap-2 border-t bg-muted/35 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-xs text-muted-foreground">{formatLocalizedNumber(descriptionLength, DEFAULT_LOCALE)} / 10000</span>
                    <Select value={draft.model} onValueChange={(model) => updateDraft({ model })}>
                      <SelectTrigger className="h-9 w-full bg-background text-sm sm:w-56">
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Model</SelectLabel>
                          {AUTOMATION_MODELS.map((model) => (
                            <SelectItem key={model} value={model}>
                              {model}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              <section className="grid gap-3">
                <div className="text-sm font-semibold text-muted-foreground">Trigger <span className="text-primary">*</span></div>
                <div className="grid gap-2 rounded-md border bg-muted/35 p-2 md:grid-cols-3">
                  {AUTOMATION_TRIGGER_TYPES.map((trigger) => {
                    const Icon = trigger.icon;
                    const active = draft.triggerType === trigger.id;
                    return (
                      <button
                        key={trigger.id}
                        type="button"
                        aria-pressed={active}
                        className={cn(
                          "grid min-h-16 grid-cols-[28px_minmax(0,1fr)] items-center gap-3 rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                          active ? "border-foreground bg-background text-foreground" : "border-border/80 bg-card/65 text-muted-foreground hover:text-foreground"
                        )}
                        onClick={() => updateDraft({ triggerType: trigger.id })}
                      >
                        <Icon className="size-4" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{trigger.label}</span>
                          <span className="mt-1 block text-xs leading-4 text-muted-foreground">{trigger.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {draft.triggerType === "schedule" ? (
                <section className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-muted-foreground">Schedule</span>
                    <Select value={draft.scheduleFrequency} onValueChange={(scheduleFrequency) => updateDraft({ scheduleFrequency })}>
                      <SelectTrigger className="h-10 w-full text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Repeat</SelectLabel>
                          {AUTOMATION_SCHEDULE_FREQUENCIES.map((frequency) => (
                            <SelectItem key={frequency.id} value={frequency.id}>
                              {frequency.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-muted-foreground">Time</span>
                    <Input
                      type="time"
                      value={draft.scheduleTime}
                      onChange={(event) => updateDraft({ scheduleTime: event.target.value })}
                      className="h-10 text-sm"
                      disabled={draft.scheduleFrequency === "manual"}
                    />
                  </label>
                </section>
              ) : null}

              {draft.triggerType === "event" ? (
                <section className="grid gap-3">
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-muted-foreground">Event source</span>
                    <Select value={draft.eventSource} onValueChange={(eventSource) => updateDraft({ eventSource })}>
                      <SelectTrigger className="h-10 w-full text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Source</SelectLabel>
                          {AUTOMATION_EVENT_SOURCES.map((source) => (
                            <SelectItem key={source} value={source}>
                              {source}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-semibold text-muted-foreground">Repository event</span>
                      <Select value={draft.eventType} onValueChange={(eventType) => updateDraft({ eventType })}>
                        <SelectTrigger className="h-10 w-full text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Event</SelectLabel>
                            {AUTOMATION_EVENT_TYPES.map((eventType) => (
                              <SelectItem key={eventType} value={eventType}>
                                {eventType}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-semibold text-muted-foreground">Linked repository</span>
                      <Input
                        value={draft.linkedRepository}
                        onChange={(event) => updateDraft({ linkedRepository: event.target.value })}
                        placeholder="No linked Git repository"
                        className="h-10 text-sm"
                      />
                    </label>
                  </div>
                </section>
              ) : null}

              {draft.triggerType === "webhook" ? (
                <section className="grid gap-2">
                  <span className="text-sm font-semibold text-muted-foreground">Webhook/API endpoint</span>
                  <Input
                    value={draft.webhookPath}
                    onChange={(event) => updateDraft({ webhookPath: event.target.value })}
                    className="h-10 font-mono text-xs"
                  />
                </section>
              ) : null}
            </div>
          </div>

          <DialogFooter className="border-t bg-background/95 px-5 py-3 backdrop-blur sm:px-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SquadMemberSectionPage({ agent, section, tasks, automations, runtime, workspaces, runs, navigate, openTerminal, updateAgent, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const sectionMeta = MEMBER_SECTIONS.find((item) => item.id === section) || MEMBER_SECTIONS[0];
  const Icon = sectionMeta.icon;
  const sectionLabel = localizedSectionLabel(sectionMeta.id, copy);

  if (section === "permissions") {
    return (
      <AgentPermissionsPage
        agent={agent}
        runtime={runtime}
        navigate={navigate}
        openTerminal={openTerminal}
        updateAgent={updateAgent}
        copy={copy}
      />
    );
  }

  if (section === "project") {
    return (
      <AgentProjectsPage
        agent={agent}
        runtime={runtime}
        workspaces={workspaces}
        navigate={navigate}
        openTerminal={openTerminal}
        updateAgent={updateAgent}
        copy={copy}
      />
    );
  }

  const rows = {
    triggers: automations.map((automation) => ({
      label: automation.name,
      value: `${automation.status} / ${automation.schedule}`,
    })),
    task: tasks.map((task) => ({
      label: task.title,
      value: `${task.status} / ${task.updatedAt}`,
    })),
    memory: agent.memory.map((memory) => ({ label: memory, value: "3 days ago" })),
    skill: agent.skills.map((skill) => {
      const installed = agent.skillInstall?.installed?.some((item) => item.id === skill);
      const failed = agent.skillInstall?.failed?.some((item) => item.id === skill);
      return {
        label: skill,
        value: failed ? "install failed" : installed ? "installed from skilled.autohand.ai" : "install pending",
      };
    }),
    connector: [{ label: "GitHub", value: "ready" }, { label: "Browser", value: "ready" }],
    im: [{ label: "Direct conversation", value: "enabled" }],
  }[section] || [];

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title={sectionLabel} />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <Card className="rounded-md border-border/80 bg-card/75 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Icon />
              {sectionLabel}
            </CardTitle>
            <CardDescription>{agent.name} / {localizedRole(agent, copy)}</CardDescription>
            <CardAction>
              <Button variant="outline" onClick={() => navigate(memberChatPath(agent.id))}>
                <MessageSquareText data-icon="inline-start" />
                {copy.backToChat}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {rows.length ? rows.map((row) => (
              <div key={`${row.label}-${row.value}`} className="rounded-md border bg-muted/25 p-4">
                <div className="truncate text-sm font-semibold">{row.label}</div>
                <div className="mt-2 truncate text-xs text-muted-foreground">{row.value}</div>
              </div>
            )) : <EmptyBlock icon={Icon} title={`${copy.noTasksYet}`} body={`${agent.name} / ${sectionLabel}`} />}
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t">
            <Button variant="outline" onClick={() => openTerminal(agent)}>
              <TerminalSquare data-icon="inline-start" />
              {copy.openCli}
            </Button>
            <Button onClick={() => navigate(memberProfilePath(agent.id, "home"))}>{copy.home}</Button>
          </CardFooter>
        </Card>

      </div>
    </div>
  );
}

function AgentProjectsPage({ agent, runtime, workspaces = [], navigate, openTerminal, updateAgent, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const maxProjects = configuredProjectLimit(runtime);
  const projects = normalizeAgentProjects(agent.projects, agent.workspace, workspaces, maxProjects);
  const projectPathKey = projects.map((project) => project.path).join("\n");
  const projectPaths = useMemo(() => new Set(projects.map((project) => project.path)), [projectPathKey]);
  const [projectDraft, setProjectDraft] = useState("");
  const [projectError, setProjectError] = useState("");
  const currentWorkspace = normalizeSquadWorkspacePath(agent.workspace, runtime);
  const workspaceChoices = workspaceOptions(workspaces, projectDraft, runtime).filter(
    (workspace) => !projectPaths.has(normalizeSquadWorkspacePath(workspace.path, runtime))
  );
  const firstAvailableWorkspace = workspaceChoices[0]?.path || "";
  const normalizedDraft = normalizeSquadWorkspacePath(projectDraft, runtime);
  const selectedOptionValue = workspaceChoices.some((workspace) => workspace.path === normalizedDraft)
    ? normalizedDraft
    : undefined;
  const atLimit = projects.length >= maxProjects;
  const duplicateProject = Boolean(normalizedDraft && projectPaths.has(normalizedDraft));
  const blockedProject = Boolean(normalizedDraft && isBlockedWorkspace(normalizedDraft, runtime));
  const canAddProject = Boolean(normalizedDraft) && !atLimit && !duplicateProject && !blockedProject;
  const remainingSlots = Math.max(0, maxProjects - projects.length);

  useEffect(() => {
    const normalized = normalizeSquadWorkspacePath(projectDraft, runtime);
    if (normalized && !projectPaths.has(normalized) && !isBlockedWorkspace(normalized, runtime)) return;
    setProjectDraft(firstAvailableWorkspace);
  }, [agent.id, firstAvailableWorkspace, projectDraft, projectPathKey, runtime]);

  useEffect(() => {
    setProjectError("");
  }, [agent.id, projectDraft]);

  function commitProjects(nextProjects, workspace = currentWorkspace) {
    if (!updateAgent) return;
    updateAgent(agent.id, {
      projects: nextProjects,
      workspace,
      stats: { ...(agent.stats || {}), projects: nextProjects.length },
      updatedAt: new Date().toISOString(),
    });
  }

  function addProject(event) {
    event.preventDefault();
    if (atLimit) {
      setProjectError(`Project limit reached (${maxProjects}).`);
      return;
    }
    if (!normalizedDraft) {
      setProjectError("Choose a project folder.");
      return;
    }
    if (blockedProject) {
      setProjectError(copy.chooseProjectFolder || "Choose a project folder or git repo.");
      return;
    }
    if (duplicateProject) {
      setProjectError("Project already added.");
      return;
    }

    const project = projectRecordFromPath({ path: normalizedDraft, addedAt: new Date().toISOString() }, workspaces);
    if (!project) {
      setProjectError("Project path is not valid.");
      return;
    }

    const nextProjects = [...projects, project].slice(0, maxProjects);
    const nextWorkspace = currentWorkspace && !isBlockedWorkspace(currentWorkspace, runtime) ? currentWorkspace : project.path;
    commitProjects(nextProjects, nextWorkspace);
    setProjectDraft("");
  }

  function removeProject(path) {
    const nextProjects = projects.filter((project) => project.path !== path);
    const nextWorkspace = currentWorkspace === path ? nextProjects[0]?.path || "" : currentWorkspace;
    commitProjects(nextProjects, nextWorkspace);
  }

  function setDefaultProject(path) {
    commitProjects(projects, path);
  }

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title={copy.projects} />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-md border border-border/80 bg-card/75">
          <div className="grid gap-5 border-b border-border/75 p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-11 place-items-center rounded-md border border-primary/35 bg-primary/15 text-primary">
                  <Folders className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold tracking-normal">Repositories & Projects</h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {agent.name} / {localizedRole(agent, copy)}
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <Metric label={copy.projects} value={`${projects.length}/${maxProjects}`} />
                <Metric label="Remaining" value={String(remainingSlots)} />
                <Metric label={copy.workspace} value={workspaceName(currentWorkspace) || "none"} />
              </div>
            </div>

            <form className="rounded-md border border-border/80 bg-background/65 p-4" onSubmit={addProject}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">Add project</div>
                <Badge variant="outline" className="rounded-md bg-background text-xs">
                  max {maxProjects}
                </Badge>
              </div>
              <div className="mt-4 grid gap-3">
                <Select value={selectedOptionValue} onValueChange={setProjectDraft} disabled={atLimit || !workspaceChoices.length}>
                  <SelectTrigger className="h-10 w-full bg-background">
                    <FolderGit2 className="size-4 text-muted-foreground" />
                    <SelectValue placeholder={copy.scanningLocalFolders || "Scanning local folders"} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-[420px]">
                    <SelectGroup>
                      <SelectLabel>{copy.localFolders}</SelectLabel>
                      {workspaceChoices.map((workspace) => (
                        <SelectItem key={workspace.path} value={workspace.path}>
                          {workspace.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Input
                  value={projectDraft}
                  onChange={(event) => setProjectDraft(event.target.value)}
                  placeholder="/Users/name/path/to/repository"
                  disabled={atLimit}
                  className="h-10 bg-background font-mono text-xs"
                />
                <Button type="submit" disabled={!canAddProject}>
                  <Plus data-icon="inline-start" />
                  Add
                </Button>
                {projectError ? <p className="text-xs text-destructive">{projectError}</p> : null}
              </div>
            </form>
          </div>

          <div className="grid gap-4 p-5 lg:p-6">
            {projects.length ? (
              projects.map((project) => {
                const isDefault = project.path === currentWorkspace;
                return (
                  <article
                    key={project.path}
                    className="grid gap-4 rounded-md border border-border/80 bg-background/65 p-4 md:grid-cols-[44px_minmax(0,1fr)_auto] md:items-center"
                  >
                    <span className="grid size-11 place-items-center rounded-md border border-border/80 bg-card text-primary">
                      <FolderGit2 className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{project.label || project.name}</h3>
                        <Badge variant="secondary" className="rounded-md bg-muted text-[11px] capitalize text-muted-foreground">
                          {project.kind}
                        </Badge>
                        {isDefault ? (
                          <Badge variant="outline" className="rounded-md border-primary/35 bg-primary/10 text-[11px] text-primary">
                            Default
                          </Badge>
                        ) : null}
                      </div>
                      <code className="mt-2 block truncate text-xs text-muted-foreground">{project.path}</code>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                      <Button type="button" variant="outline" size="sm" disabled={isDefault} onClick={() => setDefaultProject(project.path)}>
                        <GitBranch data-icon="inline-start" />
                        Default
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${project.label || project.name}`} onClick={() => removeProject(project.path)}>
                        <X />
                      </Button>
                    </div>
                  </article>
                );
              })
            ) : (
              <EmptyBlock icon={Folders} title="No projects added" body={`${agent.name} has no associated repositories yet.`} />
            )}
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => openTerminal(agent)}>
            <TerminalSquare data-icon="inline-start" />
            {copy.openCli}
          </Button>
          <Button onClick={() => navigate(memberChatPath(agent.id))}>
            <MessageSquareText data-icon="inline-start" />
            {copy.backToChat}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AgentPermissionsPage({ agent, runtime, navigate, openTerminal, updateAgent, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const permissions = normalizePermissionState(agent.permissions);
  const [activeTab, setActiveTab] = useState("toolGuard");
  const [sensitivePathDraft, setSensitivePathDraft] = useState("");
  const policyModes = [
    ...CLI_TOOL_PERMISSIONS.map((item) => permissions.modes[item.id]),
    ...Object.values(permissions.builtInPolicies),
  ];
  const allowedCount = policyModes.filter((mode) => mode === "allow").length;
  const askCount = policyModes.filter((mode) => mode === "ask").length;
  const blockedCount = policyModes.filter((mode) => mode === "block").length;
  const autonomyScore = Math.round(((allowedCount * 2 + askCount) / (policyModes.length * 2)) * 100);

  function updatePermissions(patch) {
    if (!updateAgent) return;
    updateAgent(agent.id, {
      permissions: normalizePermissionState({ ...permissions, ...patch }),
      updatedAt: new Date().toISOString(),
    });
  }

  function updateToolMode(toolId, mode) {
    updatePermissions({
      modes: {
        ...permissions.modes,
        [toolId]: mode,
      },
    });
  }

  function updateBuiltInPolicy(tool, mode) {
    updatePermissions({
      builtInPolicies: {
        ...permissions.builtInPolicies,
        [tool]: mode,
      },
    });
  }

  function updateToolGuardRule(ruleId, enabled) {
    updatePermissions({
      toolGuardRules: {
        ...permissions.toolGuardRules,
        [ruleId]: enabled,
      },
    });
  }

  function updateShellEvasionRule(ruleId, enabled) {
    updatePermissions({
      shellEvasionRules: {
        ...permissions.shellEvasionRules,
        [ruleId]: enabled,
      },
    });
  }

  function updatePermissionMode(permissionMode) {
    if (!updateAgent) return;
    const launchPolicy = permissionMode === "restricted" ? "restricted" : permissionMode === "unrestricted" ? "yes" : "ask";
    updateAgent(agent.id, {
      launch: { ...agent.launch, policy: launchPolicy },
      permissions: normalizePermissionState({ ...permissions, permissionMode }),
      updatedAt: new Date().toISOString(),
    });
  }

  function updateModelSecurity(field, value) {
    updatePermissions({
      modelSecurity: {
        ...permissions.modelSecurity,
        [field]: value,
      },
    });
  }

  function addSensitivePath() {
    const value = sensitivePathDraft.trim();
    if (!value) return;
    updatePermissions({
      sensitivePaths: Array.from(new Set([...permissions.sensitivePaths, value])),
    });
    setSensitivePathDraft("");
  }

  function removeSensitivePath(pathValue) {
    updatePermissions({
      sensitivePaths: permissions.sensitivePaths.filter((item) => item !== pathValue),
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Permission" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-md border border-border/80 bg-card/75">
          <div className="grid gap-5 border-b border-border/75 p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-11 place-items-center rounded-md border border-primary/35 bg-primary/15 text-primary">
                  <ShieldCheck className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold tracking-normal">Agent permissions</h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {agent.name} / {localizedRole(agent, copy)} / {workspaceName(agent.workspace) || "workspace"}
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <PermissionMetric icon={BadgeCheck} label="Autonomous tools" value={allowedCount} tone="text-primary" />
                <PermissionMetric icon={KeyRound} label="Approval gates" value={askCount} tone="text-amber-700 dark:text-amber-200" />
                <PermissionMetric icon={Ban} label="Blocked surfaces" value={blockedCount} tone="text-red-700 dark:text-red-200" />
              </div>
            </div>

            <div className="rounded-md border border-border/80 bg-background/65 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">Autonomy profile</div>
                  <div className="mt-1 text-xs text-muted-foreground">{autonomyScore}% confidence coverage</div>
                </div>
                <Gauge className="size-5 text-primary" />
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${autonomyScore}%` }} />
              </div>
              <div className="mt-4 grid gap-2">
                <Select value={permissions.permissionMode} onValueChange={updatePermissionMode}>
                  <SelectTrigger className="h-9 w-full">
                    <SlidersHorizontal className="size-4 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Permission mode</SelectLabel>
                      {CLI_PERMISSION_MODE_OPTIONS.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex h-10 items-center justify-between gap-3 rounded-md border border-border/80 px-3 text-xs text-muted-foreground">
                    Remember session
                    <Switch
                      checked={permissions.rememberSession}
                      onCheckedChange={(rememberSession) => updatePermissions({ rememberSession })}
                    />
                  </label>
                  <label className="flex h-10 items-center justify-between gap-3 rounded-md border border-border/80 px-3 text-xs text-muted-foreground">
                    External URLs
                    <Switch
                      checked={permissions.allUrlsAllowed}
                      onCheckedChange={(allUrlsAllowed) => updatePermissions({ allUrlsAllowed })}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-px bg-border/75 lg:grid-cols-3">
            <PermissionRuntimeItem
              icon={TerminalSquare}
              label="CLI runtime"
              value={runtime?.available ? "ready" : "offline"}
              detail={runtime?.version || runtime?.autohandPath || "local bridge"}
            />
            <PermissionRuntimeItem
              icon={LockKeyhole}
              label="Config scope"
              value="isolated"
              detail={`.autohand/agents/${agent.id}`}
            />
            <PermissionRuntimeItem
              icon={GitBranch}
              label="Workspace"
              value={workspaceName(agent.workspace) || "selected"}
              detail={agent.workspace || "No workspace selected"}
            />
          </div>
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-md border bg-card/75 p-1 lg:max-w-3xl lg:grid-cols-4">
            {PERMISSION_TABS.map((tabItem) => (
              <TabsTrigger key={tabItem.id} value={tabItem.id} className="h-10 rounded-[6px] px-3 text-sm">
                {tabItem.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="toolGuard" className="m-0 mt-5">
            <ToolGuardPanel
              permissions={permissions}
              updatePermissions={updatePermissions}
              updateRule={updateToolGuardRule}
              updateShellEvasionRule={updateShellEvasionRule}
            />
          </TabsContent>
          <TabsContent value="fileGuard" className="m-0 mt-5">
            <FileGuardPanel
              permissions={permissions}
              sensitivePathDraft={sensitivePathDraft}
              setSensitivePathDraft={setSensitivePathDraft}
              addSensitivePath={addSensitivePath}
              removeSensitivePath={removeSensitivePath}
              updatePermissions={updatePermissions}
            />
          </TabsContent>
          <TabsContent value="builtInTools" className="m-0 mt-5">
            <BuiltInToolsPanel
              permissions={permissions}
              updatePermissions={updatePermissions}
              updateBuiltInPolicy={updateBuiltInPolicy}
            />
          </TabsContent>
          <TabsContent value="modelSecurity" className="m-0 mt-5">
            <ModelSecurityPanel
              permissions={permissions}
              updatePermissions={updatePermissions}
              updateModelSecurity={updateModelSecurity}
            />
          </TabsContent>
        </Tabs>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <PermissionConfigPreview permissions={permissions} />
          <aside className="flex flex-col gap-5">
            <ShellGuardrailCard />
            <IsolationCard agent={agent} />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => openTerminal(agent)}>
                <TerminalSquare data-icon="inline-start" />
                {copy.openCli}
              </Button>
              <Button className="flex-1" onClick={() => navigate(memberChatPath(agent.id))}>
                <MessageSquareText data-icon="inline-start" />
                {copy.chat}
              </Button>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}

function PermissionSurfaceHeader({ icon: Icon, title, description, enabled, onEnabledChange, disabledMessage }) {
  return (
    <section className="rounded-md border border-border/80 bg-card/75">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Icon className="size-5 text-primary" />
            {title}
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>
      {!enabled ? (
        <div className="mx-5 mb-5 rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-200">
          {disabledMessage}
        </div>
      ) : null}
    </section>
  );
}

function ToolGuardPanel({ permissions, updatePermissions, updateRule, updateShellEvasionRule }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        <PermissionSurfaceHeader
          icon={ShieldAlert}
          title="Enable Tool Guard"
          description="Validate shell, web, and file tool parameters against Autohand Code CLI security rules. High-risk findings go through the approval flow."
          enabled={permissions.toolGuardEnabled}
          onEnabledChange={(toolGuardEnabled) => updatePermissions({ toolGuardEnabled })}
          disabledMessage="Tool Guard is disabled; detector rules will not be evaluated."
        />

        {TOOL_GUARD_RULE_GROUPS.map((group) => (
          <section key={group.id} className="overflow-hidden rounded-md border border-border/80 bg-card/75">
            <div className="flex items-center justify-between gap-3 border-b border-border/75 p-4">
              <div className="font-semibold">{group.title}</div>
              <Badge variant="outline" className="rounded-md bg-background text-xs">
                {group.rules.length}
              </Badge>
            </div>
            <div className="divide-y divide-border/70">
              {group.rules.map(([id, severity, description]) => (
                <PermissionRuleRow
                  key={id}
                  id={id}
                  severity={severity}
                  description={description}
                  enabled={permissions.toolGuardRules[id]}
                  onEnabledChange={(enabled) => updateRule(id, enabled)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <aside className="flex flex-col gap-5">
        <section className="rounded-md border border-border/80 bg-card/75">
          <div className="flex items-center justify-between gap-3 border-b border-border/75 p-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Command className="size-4 text-primary" />
                Shell Evasion
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Quote, backslash, newline, and comment tricks that commonly bypass shell filters.
              </p>
            </div>
            <Switch
              checked={permissions.shellEvasionEnabled}
              onCheckedChange={(shellEvasionEnabled) => updatePermissions({ shellEvasionEnabled })}
            />
          </div>
          <div className="grid gap-3 p-4">
            {SHELL_EVASION_RULES.map(([id, label, detail]) => (
              <label key={id} className="grid gap-2 rounded-md border border-border/80 bg-background/65 p-3">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{label}</span>
                  <Switch
                    checked={permissions.shellEvasionRules[id]}
                    onCheckedChange={(enabled) => updateShellEvasionRule(id, enabled)}
                  />
                </span>
                <span className="text-xs leading-5 text-muted-foreground">{detail}</span>
              </label>
            ))}
          </div>
        </section>
        <CommandLaneCard />
      </aside>
    </div>
  );
}

function PermissionRuleRow({ id, severity, description, enabled, onEnabledChange }) {
  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[minmax(220px,0.7fr)_120px_minmax(0,1fr)_80px] lg:items-center">
      <div className="break-words font-mono text-sm font-semibold">{id}</div>
      <SeverityBadge severity={severity} />
      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      <Switch checked={enabled} onCheckedChange={onEnabledChange} />
    </div>
  );
}

function SeverityBadge({ severity }) {
  const tone = {
    critical: "border-red-300 bg-red-100 text-red-800 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200",
    high: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-200",
    medium: "border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-400/35 dark:bg-blue-500/10 dark:text-blue-200",
  }[severity] || "border-border/80 bg-background text-muted-foreground";

  return (
    <Badge variant="outline" className={cn("w-fit rounded-md capitalize", tone)}>
      {severity}
    </Badge>
  );
}

function FileGuardPanel({ permissions, sensitivePathDraft, setSensitivePathDraft, addSensitivePath, removeSensitivePath, updatePermissions }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        <PermissionSurfaceHeader
          icon={FileCode2}
          title="Enable File Guard"
          description="Guard sensitive files and directories against read/write. Autohand Code CLI already has an immutable blacklist for secrets, credentials, private keys, and system paths."
          enabled={permissions.fileGuardEnabled}
          onEnabledChange={(fileGuardEnabled) => updatePermissions({ fileGuardEnabled })}
          disabledMessage="File Guard is disabled; paths will not be evaluated before tool execution."
        />

        <section className="rounded-md border border-border/80 bg-card/75 p-4">
          <div className="text-sm font-semibold">Add Sensitive Path</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              value={sensitivePathDraft}
              onChange={(event) => setSensitivePathDraft(event.target.value)}
              placeholder="Click to choose a directory or type a path"
              className="h-10 bg-background"
            />
            <Button type="button" onClick={addSensitivePath}>
              <Plus data-icon="inline-start" />
              Add
            </Button>
          </div>
        </section>

        <section className="overflow-hidden rounded-md border border-border/80 bg-card/75">
          <div className="border-b border-border/75 p-4">
            <div className="text-sm font-semibold">Sensitive Paths</div>
            <p className="mt-1 text-xs text-muted-foreground">Maps to the CLI security blacklist, project settings, and directory access prompts.</p>
          </div>
          <div className="divide-y divide-border/70">
            {permissions.sensitivePaths.map((pathValue) => (
              <div key={pathValue} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4">
                <code className="truncate text-sm text-muted-foreground">{pathValue}</code>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${pathValue}`} onClick={() => removeSensitivePath(pathValue)}>
                  <X />
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-5">
        <section className="rounded-md border border-border/80 bg-card/75 p-4">
          <div className="text-sm font-semibold">Path Access Controls</div>
          <div className="mt-4 grid gap-2">
            <label className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-border/80 bg-background/65 px-3 text-sm">
              All workspace paths allowed
              <Switch
                checked={permissions.allPathsAllowed}
                onCheckedChange={(allPathsAllowed) => updatePermissions({ allPathsAllowed })}
              />
            </label>
            <label className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-border/80 bg-background/65 px-3 text-sm">
              URL fetches allowed
              <Switch
                checked={permissions.allUrlsAllowed}
                onCheckedChange={(allUrlsAllowed) => updatePermissions({ allUrlsAllowed })}
              />
            </label>
          </div>
        </section>
        <PermissionScopeCard />
      </aside>
    </div>
  );
}

function BuiltInToolsPanel({ permissions, updatePermissions, updateBuiltInPolicy }) {
  return (
    <div className="flex flex-col gap-5">
      <PermissionSurfaceHeader
        icon={WrenchIcon}
        title="Enable Built-in Tool Policy Management"
        description="Set allow, ask, or deny policies for Autohand Code CLI built-ins. This maps to availableTools, excludedTools, allowPatterns, and denyPatterns."
        enabled={permissions.builtInToolPolicyEnabled}
        onEnabledChange={(builtInToolPolicyEnabled) => updatePermissions({ builtInToolPolicyEnabled })}
        disabledMessage="Built-in tool policies are disabled; the CLI falls back to context defaults and permission mode."
      />

      <div className="grid gap-5 xl:grid-cols-2">
        {BUILT_IN_TOOL_POLICY_GROUPS.map((group) => (
          <section key={group.id} className="overflow-hidden rounded-md border border-border/80 bg-card/75">
            <div className="border-b border-border/75 p-4">
              <div className="text-sm font-semibold">{group.title}</div>
            </div>
            <div className="divide-y divide-border/70">
              {group.tools.map(([tool]) => (
                <div key={tool} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-center">
                  <code className="truncate text-sm">{tool}</code>
                  <PermissionModeControl value={permissions.builtInPolicies[tool]} onChange={(mode) => updateBuiltInPolicy(tool, mode)} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ModelSecurityPanel({ permissions, updatePermissions, updateModelSecurity }) {
  const modelSecurity = permissions.modelSecurity;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        <PermissionSurfaceHeader
          icon={Brain}
          title="Enable Model Security"
          description="Lock the agent to approved providers, model IDs, thinking levels, and tool-choice behavior for enterprise or high-trust runs."
          enabled={permissions.modelSecurityEnabled}
          onEnabledChange={(modelSecurityEnabled) => updatePermissions({ modelSecurityEnabled })}
          disabledMessage="Model Security is disabled. Users can freely select any configured model."
        />

        <section className="rounded-md border border-border/80 bg-card/75 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Required provider</FieldLabel>
              <Select value={modelSecurity.provider} onValueChange={(provider) => updateModelSecurity("provider", provider)}>
                <SelectTrigger className="mt-2 h-10 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Provider</SelectLabel>
                    {MODEL_PROVIDER_OPTIONS.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {provider}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>Required model</FieldLabel>
              <Input
                value={modelSecurity.model}
                onChange={(event) => updateModelSecurity("model", event.target.value)}
                className="mt-2 h-10 bg-background"
              />
            </Field>

            <Field>
              <FieldLabel>Thinking level</FieldLabel>
              <Select value={modelSecurity.thinkingLevel} onValueChange={(thinkingLevel) => updateModelSecurity("thinkingLevel", thinkingLevel)}>
                <SelectTrigger className="mt-2 h-10 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">none</SelectItem>
                  <SelectItem value="normal">normal</SelectItem>
                  <SelectItem value="extended">extended</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>Tool choice</FieldLabel>
              <Select value={modelSecurity.toolChoice} onValueChange={(toolChoice) => updateModelSecurity("toolChoice", toolChoice)}>
                <SelectTrigger className="mt-2 h-10 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto</SelectItem>
                  <SelectItem value="required">required</SelectItem>
                  <SelectItem value="none">none</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-5">
        <section className="rounded-md border border-border/80 bg-card/75 p-4">
          <div className="text-sm font-semibold">Runtime Locks</div>
          <div className="mt-4 grid gap-2">
            {[
              ["lockModelSelector", "Lock model selector"],
              ["requireNativeToolCalling", "Require native tool calling"],
              ["requireConfiguredSearchProvider", "Require configured web search"],
            ].map(([key, label]) => (
              <label key={key} className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-border/80 bg-background/65 px-3 text-sm">
                {label}
                <Switch checked={Boolean(modelSecurity[key])} onCheckedChange={(value) => updateModelSecurity(key, value)} />
              </label>
            ))}
          </div>
        </section>
        <section className="rounded-md border border-border/80 bg-card/75 p-4">
          <div className="text-sm font-semibold">CLI mapping</div>
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
            <code className="rounded-md border bg-background p-3">provider: {modelSecurity.provider}</code>
            <code className="rounded-md border bg-background p-3">{modelSecurity.provider}.model: {modelSecurity.model}</code>
            <code className="rounded-md border bg-background p-3">LLMRequest.thinkingLevel: {modelSecurity.thinkingLevel}</code>
            <code className="rounded-md border bg-background p-3">LLMRequest.toolChoice: {modelSecurity.toolChoice}</code>
          </div>
        </section>
      </aside>
    </div>
  );
}

function WrenchIcon(props) {
  return <Settings {...props} />;
}

function PermissionScopeCard() {
  return (
    <section className="rounded-md border border-border/80 bg-card/75 p-4">
      <div className="text-sm font-semibold">Decision Scopes</div>
      <div className="mt-4 grid gap-3">
        {[
          ["Session", ".autohand/session-permissions.json"],
          ["Project", ".autohand/settings.local.json"],
          ["User", "config.json permissions"],
          ["Effective", "merged decision snapshot"],
        ].map(([label, pathValue]) => (
          <div key={label} className="rounded-md border border-border/80 bg-background/65 p-3">
            <div className="text-sm font-semibold">{label}</div>
            <code className="mt-2 block truncate text-xs text-muted-foreground">{pathValue}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

function ShellGuardrailCard() {
  return (
    <section className="rounded-md border border-border/80 bg-card/75">
      <div className="border-b border-border/75 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Hammer className="size-4 text-primary" />
          Shell guardrails
        </div>
      </div>
      <div className="divide-y divide-border/70">
        {SHELL_GUARDRAILS.map((rule) => (
          <div key={rule.id} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">{rule.label}</div>
              <Badge variant="outline" className="rounded-md bg-background text-[11px]">
                {rule.state}
              </Badge>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{rule.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CommandLaneCard() {
  return (
    <section className="rounded-md border border-border/80 bg-card/75 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Command className="size-4 text-primary" />
        Command lane
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {["rg", "cat", "sed", "bun test", "npm run build", "apply_patch"].map((item) => (
          <span key={item} className="rounded-md border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-[11px] text-primary">
            {item}
          </span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {["sudo", "rm -rf", "mkfs", "chmod 777"].map((item) => (
          <span key={item} className="rounded-md border border-red-300 bg-red-100 px-2.5 py-1 font-mono text-[11px] text-red-800 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-200">
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}

function IsolationCard({ agent }) {
  return (
    <section className="rounded-md border border-border/80 bg-card/75 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Shield className="size-4 text-primary" />
        Isolation
      </div>
      <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
        <code className="overflow-hidden text-ellipsis rounded-md border bg-background p-3">
          AUTOHAND_HOME=.autohand/agents/{agent.id}
        </code>
        <code className="overflow-hidden text-ellipsis rounded-md border bg-background p-3">
          --config .autohand/agents/{agent.id}/config.json
        </code>
      </div>
    </section>
  );
}

function PermissionConfigPreview({ permissions }) {
  const managedToolPolicies = permissions.builtInToolPolicyEnabled ? Object.entries(permissions.builtInPolicies) : [];
  const allowPatterns = managedToolPolicies
    .filter(([, mode]) => mode === "allow")
    .map(([kind]) => ({ kind }));
  const availableTools = managedToolPolicies
    .filter(([, mode]) => mode !== "block")
    .map(([kind]) => ({ kind }));
  const excludedTools = managedToolPolicies
    .filter(([, mode]) => mode === "block")
    .map(([kind]) => ({ kind }));
  const rules = managedToolPolicies
    .filter(([, mode]) => mode === "ask")
    .map(([tool]) => ({ tool, action: "prompt" }));
  const denyList = permissions.fileGuardEnabled
    ? permissions.sensitivePaths.flatMap((pathValue) => FILE_GUARD_TARGET_TOOLS.map((tool) => `${tool}:${pathValue}`))
    : [];
  const preview = {
    permissions: {
      mode: permissions.permissionMode,
      rememberSession: permissions.rememberSession,
      allowPatterns,
      availableTools,
      excludedTools,
      rules,
      denyList,
      allPathsAllowed: permissions.allPathsAllowed,
      allUrlsAllowed: permissions.allUrlsAllowed,
    },
  };

  return (
    <section className="rounded-md border border-border/80 bg-card/75 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Autohand Code CLI config preview</div>
          <p className="mt-1 text-xs text-muted-foreground">A local mapping for the settings the CLI already understands.</p>
        </div>
        <Badge variant="outline" className="rounded-md bg-background text-xs">config.json</Badge>
      </div>
      <pre className="mt-4 max-h-[320px] overflow-auto rounded-md border bg-background p-4 text-xs leading-5 text-muted-foreground">
        {JSON.stringify(preview, null, 2)}
      </pre>
    </section>
  );
}

function PermissionMetric({ icon: Icon, label, value, tone }) {
  return (
    <div className="rounded-md border border-border/80 bg-background/65 p-4">
      <div className={cn("flex items-center gap-2 text-sm font-semibold", tone)}>
        <Icon className="size-4" />
        {value}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function PermissionRuntimeItem({ icon: Icon, label, value, detail }) {
  return (
    <div className="bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function PermissionToolGroup({ group, modes, onModeChange }) {
  const Icon = group.icon;
  const allowed = group.items.filter((item) => modes[item.id] === "allow").length;

  return (
    <section className="overflow-hidden rounded-md border border-border/80 bg-card/75">
      <div className="flex flex-col gap-3 border-b border-border/75 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Icon className="size-5 text-primary" />
            {group.title}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
        </div>
        <Badge variant="outline" className="w-fit rounded-md bg-background text-xs">
          {allowed}/{group.items.length} autonomous
        </Badge>
      </div>
      <div className="divide-y divide-border/70">
        {group.items.map((item) => (
          <PermissionToolRow
            key={item.id}
            item={item}
            mode={modes[item.id]}
            onModeChange={(mode) => onModeChange(item.id, mode)}
          />
        ))}
      </div>
    </section>
  );
}

function PermissionToolRow({ item, mode, onModeChange }) {
  const meta = permissionLevelMeta(mode);

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1fr)_260px] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold">{item.name}</div>
          <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium", meta.tone)}>
            <span className={cn("size-1.5 rounded-full", meta.indicator)} />
            {meta.label}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{item.target}</span>
          <span>/</span>
          <span>{item.autonomy}</span>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {item.examples.map((example) => (
            <span key={example} className="rounded-md border border-border/80 bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {example}
            </span>
          ))}
        </div>
      </div>

      <PermissionModeControl value={mode} onChange={onModeChange} />
    </div>
  );
}

function PermissionModeControl({ value, onChange }) {
  return (
    <div className="grid grid-cols-3 rounded-md border border-border/80 bg-background p-1">
      {PERMISSION_LEVELS.map((level) => (
        <button
          key={level.id}
          type="button"
          aria-pressed={value === level.id}
          aria-label={`${level.label} ${value === level.id ? "selected" : "permission"}`}
          className={cn(
            "h-8 rounded-[6px] px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === level.id && level.tone
          )}
          onClick={() => onChange(level.id)}
        >
          {level.label}
        </button>
      ))}
    </div>
  );
}

function PageTitle({ title }) {
  return (
    <div className="flex h-14 items-center border-b border-border/75 bg-background/92 px-5 backdrop-blur-xl sm:px-6">
      <h1 className="text-lg font-semibold">{title}</h1>
    </div>
  );
}

function Profile({ agent, agents = [], tasks, automations, runtime, runs, navigate, openTerminal, updateAgent, startAutohand, initialWorkRecordTab = "timeline", locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const activity = useMemo(() => buildActivity(), []);
  const [workRecordTab, setWorkRecordTab] = useState(initialWorkRecordTab);
  const [profileEditOpen, setProfileEditOpen] = useState(false);

  useEffect(() => {
    setWorkRecordTab(initialWorkRecordTab);
  }, [agent.id, initialWorkRecordTab]);

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title={copy.home} />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="relative min-h-[210px] border-b border-border/70 pb-5">
          <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)] md:items-center">
            <div className="flex justify-center md:justify-end">
              <AgentPhotoCard agent={agent} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-semibold tracking-normal">{agent.name}</h2>
                <Badge variant="outline" className="rounded-md border-border/80 bg-muted/30">
                  <ClipboardCheck data-icon="inline-start" />
                  {localizedRole(agent, copy)}
                </Badge>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <span className="size-2 rounded-full bg-primary" />
                  {copy.online}
                </span>
                <Separator orientation="vertical" className="h-4" />
                <span>{copy.onboarding}: {formatLongDate(agent.createdAt, locale)}</span>
              </div>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">{agent.description}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={() => setProfileEditOpen(true)}>
                  <Settings data-icon="inline-start" />
                  {copy.edit}
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate(memberChatPath(agent.id))}>
                  <MessageSquareText data-icon="inline-start" />
                  {copy.chat}
                </Button>
                <Button variant="outline" size="sm" onClick={() => openTerminal(agent)}>
                  <TerminalSquare data-icon="inline-start" />
                  {copy.openCli}
                </Button>
              </div>
            </div>
          </div>
        </section>

        <Card className="rounded-md border-border/80 bg-card/75 shadow-none">
          <Tabs value={workRecordTab} onValueChange={setWorkRecordTab}>
            <CardHeader className="flex-row items-center gap-4">
              <CardTitle className="text-lg">{copy.workRecord}</CardTitle>
              <TabsList variant="line" className="h-auto flex-wrap justify-start gap-2 bg-transparent p-0">
                <TabsTrigger value="timeline" className="h-9 flex-none px-3">
                  <CalendarClock data-icon="inline-start" />
                  {copy.timelineView}
                </TabsTrigger>
                <TabsTrigger value="tasks" className="h-9 flex-none px-3">
                  <History data-icon="inline-start" />
                  {copy.tasks}
                </TabsTrigger>
                <TabsTrigger value="automations" className="h-9 flex-none px-3">
                  <Workflow data-icon="inline-start" />
                  {copy.automations}
                </TabsTrigger>
              </TabsList>
              <CardAction>
                <Button variant="ghost" size="icon-sm" aria-label={copy.closeWorkRecord}>
                  <X />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <TabsContent value="timeline" className="m-0 flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label={copy.activeDays} value={`${formatLocalizedNumber(agent.stats.activeDays ?? 0, locale)}d`} />
                  <Metric label={copy.automations} value={formatLocalizedNumber(automations.length || agent.stats.automations || 0, locale)} />
                  <Metric label={copy.tasks} value={formatLocalizedNumber(tasks.length || agent.stats.tasks || 0, locale)} />
                  <Metric label={copy.projects} value={formatLocalizedNumber(agent.stats.projects || 0, locale)} />
                </div>
                <HandoffTimelinePanel tasks={tasks} agents={agents} locale={locale} copy={copy} />
                <ActivityHeatmap values={activity} />
              </TabsContent>
              <TabsContent value="tasks" className="m-0">
                <WorkRecordTasksTable tasks={tasks} copy={copy} locale={locale} />
              </TabsContent>
              <TabsContent value="automations" className="m-0">
                <WorkRecordAutomationsTable automations={automations} copy={copy} locale={locale} />
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        <Card className="rounded-md border-border/80 bg-card/75 shadow-none">
          <CardHeader className="flex-row items-center gap-3">
            <CardTitle>{copy.memoryGrowth}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate(memberProfilePath(agent.id, "memory"))}>
              {copy.viewAllMemory}
              <ChevronRight data-icon="inline-end" />
            </Button>
            <CardAction>
              <Button variant="ghost" size="icon-sm" aria-label={copy.closeMemory}>
                <X />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="grid min-h-72 gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
            <div className="grid place-items-center text-sm text-muted-foreground">{copy.noMemoryUpdatesYet}</div>
            <div>
              <div className="mb-4 text-sm font-semibold text-muted-foreground">{copy.recentlyLearned}</div>
              <div className="flex flex-col gap-3">
                {agent.memory.map((item) => (
                  <div key={item} className="grid grid-cols-[40px_minmax(0,1fr)_80px] items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-md bg-[#211b40] text-[#8472ff]">
                      <Sparkles />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{item.split(":")[0]}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.split(":")[1]?.trim() || "autohand-squad-skill"}</span>
                    </span>
                    <span className="text-right text-xs text-muted-foreground">{formatCopy(copy.daysAgo, { count: formatLocalizedNumber(3, locale) })}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
          <RunList runs={runs} copy={copy} />
          <AutomationSummary automations={automations} copy={copy} />
        </div>
      </div>
      <AgentProfileEditDialog
        agent={agent}
        open={profileEditOpen}
        onOpenChange={setProfileEditOpen}
        onSave={(patch) => updateAgent?.(agent.id, patch)}
      />
    </div>
  );
}

function ActivityHeatmap({ values }) {
  const months = ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"];
  const cells = Array.from({ length: 286 }, (_, index) => {
    const reverseIndex = values.length - 1 - (285 - index);
    return reverseIndex >= 0 ? values[reverseIndex] : 0;
  });
  return (
    <div className="overflow-x-auto rounded-md border border-border/80 bg-muted/25 p-4">
      <div className="min-w-[760px]">
        <div className="ml-14 grid [grid-template-columns:repeat(13,minmax(0,1fr))] text-center text-xs text-muted-foreground">
          {months.map((month, index) => (
            <span key={`${month}-${index}`}>{month}</span>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[44px_minmax(0,1fr)] gap-3">
          <div className="grid grid-rows-7 text-xs text-muted-foreground">
            <span />
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
          </div>
          <div className="grid grid-flow-col grid-rows-7 gap-1.5">
            {cells.map((value, index) => (
              <span
                key={`${index}-${value}`}
                className={cn(
                  "size-3 rounded-[3px]",
                  value === 0 && "bg-muted-foreground/15 dark:bg-muted/35",
                  value === 1 && "bg-primary/35",
                  value === 2 && "bg-primary/65",
                  value === 3 && "bg-primary"
                )}
                title={`Day ${index + 1}: level ${value}`}
              />
            ))}
          </div>
        </div>
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>Less</span>
          {[0, 1, 2, 3].map((value) => (
            <span
              key={value}
              className={cn(
                "size-3 rounded-[3px]",
                value === 0 && "bg-muted-foreground/15 dark:bg-muted/35",
                value === 1 && "bg-primary/35",
                value === 2 && "bg-primary/65",
                value === 3 && "bg-primary"
              )}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

function AutomationSummary({ automations, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  return (
    <Card className="border-border/80 bg-card/75">
      <CardHeader>
        <CardTitle>{copy.automations}</CardTitle>
        <CardDescription>{copy.scheduledLocalAutohandWork}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.name}</TableHead>
              <TableHead>{copy.schedule}</TableHead>
              <TableHead>{copy.target}</TableHead>
              <TableHead>{copy.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {automations.map((automation) => (
              <TableRow key={automation.id}>
                <TableCell className="font-medium">{automation.name}</TableCell>
                <TableCell>{automationScheduleLabel(automation)}</TableCell>
                <TableCell>{workspaceName(automation.workspace) || automation.target}</TableCell>
                <TableCell><StatusBadge status={automation.status} copy={copy} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Extensions({ runtime, runs }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <div>
        <Badge variant="outline" className="mb-4 bg-primary/10 text-primary">Runtime bridge</Badge>
        <h1 className="text-4xl font-extrabold sm:text-5xl">Autohand Squad launch infrastructure</h1>
        <p className="mt-4 max-w-3xl text-muted-foreground">Local CLI processes, terminal handoff, and run output polling.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Runtime available" value={runtime?.available ? "yes" : "no"} />
        <Metric label="Tracked runs" value={runs.length} />
        <Metric label="Bridge mode" value="local" />
      </div>
      <Card className="border-border/80 bg-card/75">
        <CardHeader>
          <CardTitle>Extensions</CardTitle>
          <CardDescription>Bridge services and subscribed events</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Subscribed events</TableHead>
                <TableHead className="text-right">Restarts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {extensionRows.map((row) => (
                <TableRow key={row.name}>
                  <TableCell>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">{row.version}</div>
                  </TableCell>
                  <TableCell><StatusBadge status={row.status} /></TableCell>
                  <TableCell className="max-w-md truncate">{row.events.join(", ")}</TableCell>
                  <TableCell className="text-right">{row.restarts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsAnalyticsPage({ locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  return (
    <div className="min-h-screen bg-background">
      <PageTitle title={copy.analytics} />
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        <AnalyticsPanel active locale={locale} />
      </div>
    </div>
  );
}

function SettingsSheet({
  open,
  onOpenChange,
  themePreference,
  setThemePreference,
  handoffSettings,
  setHandoffSettings,
  effectiveTheme,
  systemTheme,
  localePreference,
  setLocalePreference,
  localeResolution,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  runtime,
  navigate,
}) {
  const activeLocale = localeResolution?.locale || DEFAULT_LOCALE;
  const systemLocale = localeResolution?.systemLocale || detectSystemLocale();
  const manualLocale = localeResolution?.manualLocale || DEFAULT_LOCALE;
  const localeGroups = useMemo(
    () => [
      {
        id: "english",
        label: copy.englishVariants,
        locales: SUPPORTED_LOCALES.filter((locale) => locale.group === "english"),
      },
      {
        id: "requested",
        label: copy.requestedLocales,
        locales: SUPPORTED_LOCALES.filter((locale) => locale.group === "requested"),
      },
      {
        id: "popular",
        label: copy.popularLocales,
        locales: SUPPORTED_LOCALES.filter((locale) => locale.group === "popular"),
      },
    ],
    [copy.englishVariants, copy.popularLocales, copy.requestedLocales]
  );
  const selectedLocaleValue = localePreference?.mode === LOCALE_MODE_MANUAL ? manualLocale : LOCALE_MODE_AUTO;
  const localeDetail =
    localePreference?.mode === LOCALE_MODE_MANUAL
      ? `${copy.manualLanguage}: ${formatLocaleSummary(manualLocale, activeLocale)}`
      : `${copy.osLanguage}: ${formatLocaleSummary(systemLocale, activeLocale)}`;
  const normalizedThemePreference = normalizeThemePreference(themePreference);
  const activeThemeLabel = effectiveTheme === THEME_MODE_LIGHT ? copy.light : copy.dark;
  const visibleThemePresetSurface = normalizeThemeSurface(effectiveTheme);
  const visibleThemePresetValue = normalizedThemePreference[`${visibleThemePresetSurface}Theme`];
  const themeModeDetail =
    normalizedThemePreference.mode === THEME_MODE_SYSTEM
      ? formatCopy(copy.systemThemeDetail, { theme: activeThemeLabel })
      : formatCopy(copy.pinnedThemeDetail, { theme: activeThemeLabel });
  const bridgeHandoffRetryMode = normalizeHandoffRetryMode(runtime?.handoffs?.retryMode);
  const effectiveHandoffRetryMode = resolveHandoffRetryMode(handoffSettings, runtime);
  const selectedHandoffRetryValue = handoffSettings?.retryMode || HANDOFF_RETRY_BRIDGE_DEFAULT;
  const handoffRetryDetail = handoffSettings?.retryMode
    ? handoffRetryModeDescription(effectiveHandoffRetryMode, copy)
    : formatCopy(copy.handoffRetryBridgeDefaultDetail, {
        mode: handoffRetryModeLabel(bridgeHandoffRetryMode, copy),
      });

  function updateLocale(value) {
    if (value === LOCALE_MODE_AUTO) {
      setLocalePreference({ mode: LOCALE_MODE_AUTO, locale: manualLocale });
      return;
    }

    setLocalePreference({ mode: LOCALE_MODE_MANUAL, locale: resolveSupportedLocale(value) || DEFAULT_LOCALE });
  }

  function updateThemeMode(value) {
    setThemePreference((current) =>
      normalizeThemePreference({
        ...normalizeThemePreference(current),
        mode: normalizeThemeMode(value),
      })
    );
  }

  function updateThemePreset(surface, value) {
    const normalizedSurface = normalizeThemeSurface(surface);
    setThemePreference((current) =>
      normalizeThemePreference({
        ...normalizeThemePreference(current),
        [`${normalizedSurface}Theme`]: value,
      })
    );
  }

  function updateHandoffRetryMode(value) {
    if (value === HANDOFF_RETRY_BRIDGE_DEFAULT) {
      setHandoffSettings({ retryMode: "" });
      return;
    }

    setHandoffSettings({ retryMode: normalizeHandoffRetryMode(value) });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={copy.close} className="border-border/80 p-0">
        <SheetHeader className="border-b p-5">
          <SheetTitle>{copy.consolePreferences}</SheetTitle>
          <SheetDescription>{runtime?.autohandPath || "Autohand path not found"}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-5">
          <>
            <Field orientation="responsive" className="items-center justify-between rounded-lg border p-4">
                <FieldContent>
                  <FieldTitle>{copy.theme}</FieldTitle>
                  <FieldDescription>{themeModeDetail}</FieldDescription>
                </FieldContent>
                <ToggleGroup
                  type="single"
                  value={normalizedThemePreference.mode}
                  onValueChange={(value) => value && updateThemeMode(value)}
                  variant="outline"
                  className="grid w-full grid-cols-3 sm:w-fit"
                >
                  <ToggleGroupItem value={THEME_MODE_SYSTEM} className="justify-center px-2">
                    <Monitor data-icon="inline-start" />
                    {copy.system}
                  </ToggleGroupItem>
                  <ToggleGroupItem value={THEME_MODE_DARK} className="justify-center px-2">
                    <Moon data-icon="inline-start" />
                    {copy.dark}
                  </ToggleGroupItem>
                  <ToggleGroupItem value={THEME_MODE_LIGHT} className="justify-center px-2">
                    <Sun data-icon="inline-start" />
                    {copy.light}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <section className="rounded-lg border p-4" aria-labelledby="theme-presets-title">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-primary/12 text-primary">
                    <Palette className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 id="theme-presets-title" className="font-semibold">{copy.themePresets}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{copy.themePresetsDescription}</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  <ThemePresetControl
                    key={visibleThemePresetSurface}
                    surface={visibleThemePresetSurface}
                    value={visibleThemePresetValue}
                    active
                    copy={copy}
                    onValueChange={(value) => updateThemePreset(visibleThemePresetSurface, value)}
                  />
                </div>
                {normalizedThemePreference.mode === THEME_MODE_SYSTEM ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {formatCopy(copy.systemPreferenceSummary, {
                      theme: systemTheme === THEME_MODE_LIGHT ? copy.light : copy.dark,
                    })}
                  </p>
                ) : null}
              </section>
              <Field orientation="responsive" className="items-center justify-between rounded-lg border p-4">
                <FieldContent>
                  <FieldTitle>
                    <Languages data-icon="inline-start" />
                    {copy.language}
                  </FieldTitle>
                  <FieldDescription>{localeDetail}</FieldDescription>
                </FieldContent>
                <Select value={selectedLocaleValue} onValueChange={updateLocale}>
                  <SelectTrigger className="h-10 w-full min-w-0 justify-between sm:w-[17rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end" className="max-h-[min(70vh,28rem)] w-[calc(100vw-2rem)] sm:w-[20rem]">
                    <SelectItem value={LOCALE_MODE_AUTO}>
                      {copy.automatic} - {copy.useAutomaticLocale}
                    </SelectItem>
                    {localeGroups.map((group) => (
                      <SelectGroup key={group.id}>
                        <SelectLabel>{group.label}</SelectLabel>
                        {group.locales.map((locale) => (
                          <SelectItem key={locale.code} value={locale.code}>
                            {formatLocaleMenuLabel(locale.code, activeLocale)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="responsive" className="items-center justify-between rounded-lg border p-4">
                <FieldContent>
                  <FieldTitle>
                    <Workflow data-icon="inline-start" />
                    {copy.handoffRetryPolicy}
                  </FieldTitle>
                  <FieldDescription>{handoffRetryDetail}</FieldDescription>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {formatCopy(copy.handoffRetryEnvDefault, {
                      variable: "AUTOHAND_SQUAD_HANDOFF_RETRY_MODE",
                      mode: handoffRetryModeLabel(bridgeHandoffRetryMode, copy),
                    })}
                  </div>
                </FieldContent>
                <Select value={selectedHandoffRetryValue} onValueChange={updateHandoffRetryMode}>
                  <SelectTrigger className="h-10 w-full min-w-0 justify-between sm:w-[18rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end" className="w-[calc(100vw-2rem)] sm:w-[21rem]">
                    <SelectItem value={HANDOFF_RETRY_BRIDGE_DEFAULT}>
                      {formatCopy(copy.useBridgeDefault, {
                        mode: handoffRetryModeLabel(bridgeHandoffRetryMode, copy),
                      })}
                    </SelectItem>
                    {HANDOFF_RETRY_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {handoffRetryModeLabel(mode, copy)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <button
                type="button"
                className="flex items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-muted/60"
                onClick={() => {
                  onOpenChange(false);
                  navigate("/extensions");
                }}
              >
                <span>
                  <span className="block font-semibold">{copy.runtimeBridge}</span>
                  <span className="block text-sm text-muted-foreground">{runtime?.version || copy.checkingRuntime}</span>
                </span>
                <ChevronRight />
              </button>
              <Alert>
                <Database />
                <AlertTitle>{copy.localStorage}</AlertTitle>
                <AlertDescription>{copy.localStorageDescription}</AlertDescription>
              </Alert>
          </>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AnalyticsPanel({ active, locale }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadAnalytics() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/analytics");
      setSnapshot(data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const data = await api("/api/analytics");
        if (!cancelled) {
          setSnapshot(data);
          setError("");
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    setLoading(true);
    load();
    const timer = window.setInterval(load, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);

  const work = snapshot?.work || {};
  const services = snapshot?.services || {};
  const telemetry = snapshot?.telemetry || {};
  const versions = snapshot?.versions || {};
  const recentErrors = Array.isArray(snapshot?.recentErrors) ? snapshot.recentErrors : [];
  const eventEntries = Object.entries(telemetry.eventCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const serviceRows = [
    ["Squad daemon", services.mainDaemon],
    ["Analytics daemon", services.analyticsDaemon],
    ["Web server", services.webServer],
  ];
  const metricCards = [
    {
      label: "Active daemons",
      value: services.activeDaemons ?? 0,
      detail: snapshot?.source || "local",
      icon: Server,
    },
    {
      label: "Active work",
      value: work.activeWork ?? 0,
      detail: `${formatAnalyticsNumber(work.workingAgents ?? 0, locale)} working agents`,
      icon: Activity,
    },
    {
      label: "Queue volume",
      value: work.queueVolume ?? 0,
      detail: `${formatAnalyticsNumber(work.scheduledJobs ?? 0, locale)} scheduled`,
      icon: LayoutList,
    },
    {
      label: "Failure rate",
      value: formatAnalyticsPercent(work.failureRate),
      detail: `${formatAnalyticsNumber(work.failedRuns ?? 0, locale)} failed runs`,
      icon: AlertTriangle,
    },
    {
      label: "Telemetry events",
      value: telemetry.totalEvents ?? 0,
      detail: `${formatAnalyticsNumber(telemetry.errors ?? 0, locale)} errors`,
      icon: Gauge,
    },
  ];

  if (loading && !snapshot) {
    return (
      <div className="grid gap-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <section className="grid gap-5" aria-label="Analytics">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Analytics unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">Analytics</h3>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {formatAnalyticsTimestamp(snapshot?.generatedAt, locale) || "Waiting for local data"}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={loadAnalytics} disabled={loading}>
          <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {metricCards.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.label} className="rounded-lg">
              <CardHeader className="space-y-0 pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardDescription>{metric.label}</CardDescription>
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <CardTitle className="text-2xl tracking-normal">
                  {typeof metric.value === "number" ? formatAnalyticsNumber(metric.value, locale) : metric.value}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">{metric.detail}</CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">Services</CardTitle>
          <CardDescription>{versions.installedVersion || versions.runtimeVersion || "No installed version recorded"}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>URL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serviceRows.map(([label, record]) => (
                <TableRow key={label}>
                  <TableCell className="font-medium">{label}</TableCell>
                  <TableCell><StatusBadge status={record?.running ? "ready" : "offline"} /></TableCell>
                  <TableCell className="max-w-[11rem] truncate text-muted-foreground">{record?.url || "not recorded"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-base">Queue</CardTitle>
            <CardDescription>
              {formatAnalyticsNumber(work.queuedJobs ?? 0, locale)} queued, {formatAnalyticsNumber(work.completedRuns ?? 0, locale)} completed
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 text-sm">
            <Metric label="Running" value={formatAnalyticsNumber(work.runningRuns ?? 0, locale)} />
            <Metric label="Failed" value={formatAnalyticsNumber(work.failedRuns ?? 0, locale)} />
            <Metric label="Rejected" value={formatAnalyticsNumber(work.rejectedRuns ?? 0, locale)} />
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-base">Telemetry</CardTitle>
            <CardDescription>{formatAnalyticsNumber(telemetry.queueCreated ?? 0, locale)} queue creates tracked</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {eventEntries.length ? (
              eventEntries.map(([event, count]) => (
                <div key={event} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-muted-foreground">{event}</span>
                  <span className="font-medium">{formatAnalyticsNumber(count, locale)}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No telemetry events recorded.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">Recent failures</CardTitle>
          <CardDescription>{formatAnalyticsNumber(recentErrors.length, locale)} visible</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {recentErrors.length ? (
            recentErrors.map((item, index) => (
              <div key={`${item.runId || item.message}-${index}`} className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">{item.message}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatAnalyticsTimestamp(item.at, locale) || "unknown"}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{item.source}{item.runId ? ` - ${item.runId}` : ""}</div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No recent failures recorded.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function formatAnalyticsNumber(value, locale) {
  return formatLocalizedNumber(Number(value) || 0, locale);
}

function formatAnalyticsPercent(value) {
  const numericValue = Number(value) || 0;
  return `${Math.round(numericValue * 100)}%`;
}

function formatAnalyticsTimestamp(value, locale) {
  if (!value) return "";
  const text = String(value);
  const unixMatch = text.match(/^unix-ms:(\d+)$/);
  const date = unixMatch ? new Date(Number(unixMatch[1])) : new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function ThemePresetControl({ surface, value, active, copy, onValueChange }) {
  const presets = THEME_PRESETS[surface] || [];
  const selectedPreset = THEME_PRESET_MAP[surface].get(value) || presets[0];
  const Icon = surface === THEME_MODE_LIGHT ? Sun : Moon;
  const title = surface === THEME_MODE_LIGHT ? copy.lightTheme : copy.darkTheme;
  const detail = active
    ? copy.activeNow
    : surface === THEME_MODE_LIGHT
      ? copy.savedForLight
      : copy.savedForDark;

  return (
    <div
      className={cn(
        "rounded-md border bg-muted/35 p-3 transition-colors",
        active && "border-primary/70 bg-primary/10 ring-1 ring-primary/25"
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="size-4 text-muted-foreground" />
            <span>{title}</span>
            {active ? <Badge variant="secondary" className="rounded-sm px-1.5 py-0 text-[10px]">{copy.current}</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <Select value={selectedPreset.id} onValueChange={onValueChange}>
          <SelectTrigger className="h-10 w-full min-w-0 justify-between">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" className="w-[calc(100vw-2rem)] sm:w-[16rem]">
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                <ThemeSwatches preset={preset} />
                <span className="truncate">{preset.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3 flex items-start gap-2">
        <ThemeSwatches preset={selectedPreset} className="mt-1 gap-1.5" />
        <span className="min-w-0 text-xs leading-5 text-muted-foreground">{selectedPreset.description}</span>
      </div>
    </div>
  );
}

function ThemeSwatches({ preset, className }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1", className)} aria-hidden="true">
      {preset.swatches.map((color) => (
        <span
          key={`${preset.id}-${color}`}
          className="size-3 rounded-full border border-foreground/15 shadow-sm"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

const rootElement = document.getElementById("root");
const root = globalThis.__autohandSquadRoot || createRoot(rootElement);
globalThis.__autohandSquadRoot = root;

root.render(
  <RenderErrorBoundary>
    <App />
  </RenderErrorBoundary>
);
