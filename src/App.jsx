import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ArrowLeft,
  BadgeCheck,
  Ban,
  BookOpen,
  Bot,
  Boxes,
  Brain,
  BrainCog,
  Bug,
  CalendarCheck2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CircleSlash,
  CircleUserRound,
  Layers,
  ListChecks,
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
  Hash,
  Lock,
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
  ScanSearch,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  TerminalSquare,
  Trash2,
  Unplug,
  Upload,
  UserRound,
  Users,
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
  initialChannels,
  initialMemoryInbox,
  initialMessages,
  initialRecipes,
  initialTasks,
  AUTOHAND_SKILLS_REGISTRY_URL,
  CHANNEL_VISIBILITY_PRIVATE,
  CHANNEL_VISIBILITY_PUBLIC,
  brainCardFields,
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
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
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
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { Progress } from "@/components/ui/progress";
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
  channels: "autohandSquad.v1.channels",
  channelThreads: "autohandSquad.v1.channelThreads",
  channelMessages: "autohandSquad.v1.channelMessages",
  chatSettings: "autohandSquad.v1.chatSettings",
  locale: "autohandSquad.v1.locale",
  handoffSettings: "autohandSquad.v1.handoffSettings",
  memoryInbox: "autohandSquad.v1.memoryInbox",
  messages: "autohandSquad.v1.messages",
  sidebarCollapsed: "autohandSquad.v1.sidebarCollapsed",
  onboarding: "autohandSquad.v1.onboarding",
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

const MISSION_CONTROL_ROUTE = "/mission-control";
const SQUAD_DIRECTORY_ROUTE = "/squad";
const CHANNELS_ROUTE = "/channels";
const CHANNEL_VISIBILITY_OPTIONS = [
  { id: CHANNEL_VISIBILITY_PUBLIC, icon: Globe2, labelKey: "channelPublic", detailKey: "channelPublicDetail" },
  { id: CHANNEL_VISIBILITY_PRIVATE, icon: Lock, labelKey: "channelPrivate", detailKey: "channelPrivateDetail" },
];
const RECOVERED_PIE_SHOP_CHANNEL_ID = "channel-6eb6c6df-afc4-48c4-bac5-b3ceb9fe3e55";
const RECOVERED_PIE_SHOP_WORKSPACE = "/Users/igorcosta/Documents/autohand/demo/pieshop";
const RECOVERED_CHANNELS = [
  {
    id: RECOVERED_PIE_SHOP_CHANNEL_ID,
    name: "clients-pie-shop-nz",
    visibility: CHANNEL_VISIBILITY_PUBLIC,
    memberIds: ["b3bc502e795a", "asq_noah_frontend", "asq_iris_reviewer", "asq_kai_devops"],
    creatorId: "codex-live-test",
    autoModeDefault: true,
    createdAt: "2026-07-05T01:19:04.493Z",
    updatedAt: "2026-07-05T10:09:47.000Z",
  },
];
const RECOVERED_CHANNEL_THREADS = [
  {
    id: "thread_live_pieshop_mr73s27l",
    channelId: RECOVERED_PIE_SHOP_CHANNEL_ID,
    parentMessageId: "thread_live_pieshop_mr73s27l-root",
    title: "Build a static NZ pie shop website",
    creatorId: "codex-live-test",
    memberIds: ["asq_noah_frontend"],
    autoMode: false,
    selfJudge: false,
    replyCount: 1,
    createdAt: "2026-07-05T01:19:04.498Z",
    updatedAt: "2026-07-05T01:27:47.553Z",
  },
  {
    id: "thread_live_pieshop_openrouter_mr74gsz5",
    channelId: RECOVERED_PIE_SHOP_CHANNEL_ID,
    parentMessageId: "thread_live_pieshop_openrouter_mr74gsz5-root",
    title: "OpenRouter live static NZ pie shop build",
    creatorId: "codex-live-test",
    memberIds: ["asq_noah_frontend", "b3bc502e795a", "asq_iris_reviewer", "asq_kai_devops"],
    autoMode: false,
    selfJudge: false,
    replyCount: 4,
    createdAt: "2026-07-05T01:38:18.955Z",
    updatedAt: "2026-07-05T02:08:00.000Z",
  },
];
const RECOVERED_CHANNEL_MESSAGES = {
  [RECOVERED_PIE_SHOP_CHANNEL_ID]: [
    {
      id: "thread_live_pieshop_mr73s27l-root",
      channelId: RECOVERED_PIE_SHOP_CHANNEL_ID,
      channelName: "clients-pie-shop-nz",
      role: "user",
      body: "Build a static NZ pie shop website",
      status: "complete",
      time: "13:19",
      threadId: "thread_live_pieshop_mr73s27l",
      parentMessageId: "",
      createdAt: "2026-07-05T01:19:04.498Z",
      updatedAt: "2026-07-05T01:19:04.498Z",
    },
    {
      id: "thread_live_pieshop_mr73s27l-recovered",
      channelId: RECOVERED_PIE_SHOP_CHANNEL_ID,
      channelName: "clients-pie-shop-nz",
      role: "agent",
      agentId: "asq_noah_frontend",
      body: "Recovered from local run evidence: the first pie-shop run created the project direction, but its full reply bodies were not persisted to the channel log. The later OpenRouter thread below contains the actionable implementation, QA, review, and serving handoff.",
      status: "complete",
      time: "13:27",
      threadId: "thread_live_pieshop_mr73s27l",
      parentMessageId: "thread_live_pieshop_mr73s27l-root",
      workspace: RECOVERED_PIE_SHOP_WORKSPACE,
      transport: "recovered",
      createdAt: "2026-07-05T01:27:47.553Z",
      updatedAt: "2026-07-05T01:27:47.553Z",
    },
    {
      id: "thread_live_pieshop_openrouter_mr74gsz5-root",
      channelId: RECOVERED_PIE_SHOP_CHANNEL_ID,
      channelName: "clients-pie-shop-nz",
      role: "user",
      body: "OpenRouter live static NZ pie shop build",
      status: "complete",
      time: "13:38",
      threadId: "thread_live_pieshop_openrouter_mr74gsz5",
      parentMessageId: "",
      createdAt: "2026-07-05T01:38:18.955Z",
      updatedAt: "2026-07-05T01:38:18.955Z",
    },
    {
      id: "thread_live_pieshop_openrouter_mr74gsz5-noah",
      channelId: RECOVERED_PIE_SHOP_CHANNEL_ID,
      channelName: "clients-pie-shop-nz",
      role: "agent",
      agentId: "asq_noah_frontend",
      body: "Noah implementation handoff: built the static site workspace with index.html, styles.css, script.js, and README.md. The page links the CSS and JS, includes menu filter buttons, pie cards with data-type values, and an order modal wired by orderBtn, closeBtn, and orderModal.",
      status: "complete",
      time: "13:48",
      threadId: "thread_live_pieshop_openrouter_mr74gsz5",
      parentMessageId: "thread_live_pieshop_openrouter_mr74gsz5-root",
      workspace: RECOVERED_PIE_SHOP_WORKSPACE,
      transport: "recovered",
      createdAt: "2026-07-05T01:48:00.000Z",
      updatedAt: "2026-07-05T01:48:00.000Z",
    },
    {
      id: "thread_live_pieshop_openrouter_mr74gsz5-eva",
      channelId: RECOVERED_PIE_SHOP_CHANNEL_ID,
      channelName: "clients-pie-shop-nz",
      role: "agent",
      agentId: "b3bc502e795a",
      body: "Eva QA handoff: verified index.html, styles.css, script.js, and README.md are present; HTML links the assets; the script selectors match orderBtn, closeBtn, and orderModal; README includes local run commands.",
      status: "complete",
      time: "13:55",
      threadId: "thread_live_pieshop_openrouter_mr74gsz5",
      parentMessageId: "thread_live_pieshop_openrouter_mr74gsz5-root",
      workspace: RECOVERED_PIE_SHOP_WORKSPACE,
      transport: "recovered",
      createdAt: "2026-07-05T01:55:00.000Z",
      updatedAt: "2026-07-05T01:55:00.000Z",
    },
    {
      id: "thread_live_pieshop_openrouter_mr74gsz5-iris",
      channelId: RECOVERED_PIE_SHOP_CHANNEL_ID,
      channelName: "clients-pie-shop-nz",
      role: "agent",
      agentId: "asq_iris_reviewer",
      body: "Iris review handoff: reviewed the evidence after the fixes. The site structure uses semantic sections, selector guards, active filter state, modal focus and escape handling, and README serving commands. Residual risk is limited to deeper browser/manual accessibility testing beyond the static checks.",
      status: "complete",
      time: "14:03",
      threadId: "thread_live_pieshop_openrouter_mr74gsz5",
      parentMessageId: "thread_live_pieshop_openrouter_mr74gsz5-root",
      workspace: RECOVERED_PIE_SHOP_WORKSPACE,
      transport: "recovered",
      createdAt: "2026-07-05T02:03:00.000Z",
      updatedAt: "2026-07-05T02:03:00.000Z",
    },
    {
      id: "thread_live_pieshop_openrouter_mr74gsz5-kai",
      channelId: RECOVERED_PIE_SHOP_CHANNEL_ID,
      channelName: "clients-pie-shop-nz",
      role: "agent",
      agentId: "asq_kai_devops",
      body: "Kai serving handoff: the static site is ready to serve from /Users/igorcosta/Documents/autohand/demo/pieshop. Verified local URL used port 4174 because 4173 was already occupied. Commands: cd /Users/igorcosta/Documents/autohand/demo/pieshop; python3 -m http.server 4174 --bind 127.0.0.1; open http://127.0.0.1:4174.",
      status: "complete",
      time: "14:08",
      threadId: "thread_live_pieshop_openrouter_mr74gsz5",
      parentMessageId: "thread_live_pieshop_openrouter_mr74gsz5-root",
      workspace: RECOVERED_PIE_SHOP_WORKSPACE,
      transport: "recovered",
      createdAt: "2026-07-05T02:08:00.000Z",
      updatedAt: "2026-07-05T02:08:00.000Z",
    },
  ],
};
const ONBOARDING_ROUTE = "/welcome";
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
const MEMORY_SCOPES = [
  { id: "personal", label: "Personal", detail: "Only this squad member uses it by default." },
  { id: "project", label: "Project", detail: "Shared for this repository or normalized workspace." },
  { id: "team", label: "Team", detail: "Useful across the whole Autohand Squad." },
];
const MEMORY_STATUSES = ["pending", "accepted", "rejected"];

function storageKeysFor(name) {
  return [STORAGE_KEYS[name]];
}

const RUN_MODES = [
  { id: "prompt", label: "Command", detail: "--prompt" },
  { id: "auto", label: "Auto", detail: "--auto-mode" },
  { id: "goal", label: "Goal", detail: "--goal" },
];

const SIDEBAR_SHORTCUT_LABEL = "Cmd/Ctrl+B";
const LIVE_RUN_STATUSES = new Set(["queued", "running", "launching"]);
const WORKING_TASK_STATUSES = new Set(["running", "launching", "handoff-pending"]);
const QUEUED_TASK_STATUSES = new Set(["pending", "handoff-pending"]);
const OFFLINE_MEMBER_STATUSES = new Set(["offline", "archived", "disabled"]);
const TERMINAL_TASK_STATUSES = new Set(["completed", "cancelled", "failed", "stopped"]);
const PRESENCE_PENDING_TASK_MAX_AGE_MS = 2 * 60 * 1000;
const PRESENCE_LOADING_MESSAGE_MAX_AGE_MS = 5 * 60 * 1000;
const ONBOARDING_VERSION = 1;
const ONBOARDING_STATUS_ACTIVE = "active";
const ONBOARDING_STATUS_COMPLETED = "completed";
const ONBOARDING_STATUS_SKIPPED = "skipped";

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
  { id: "ladder", label: "Ladder" },
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

const DEFAULT_AUTONOMY_LADDER_LEVEL = "edit-files";

const AUTONOMY_LADDER_LEVELS = [
  {
    id: "chat-only",
    rank: 1,
    label: "Chat only",
    shortLabel: "Chat",
    icon: MessageSquareText,
    permissionMode: "restricted",
    launchPolicy: "restricted",
    summary: "The member can answer, plan, and ask follow-up questions without touching the workspace.",
    available: ["Conversation", "planning", "role profile"],
    approvals: ["Memory saves", "handoff requests"],
    blocked: ["Shell", "file access", "browser control", "GitHub", "MCP connectors"],
  },
  {
    id: "suggest-commands",
    rank: 2,
    label: "Suggest commands",
    shortLabel: "Suggest",
    icon: Command,
    permissionMode: "restricted",
    launchPolicy: "restricted",
    summary: "The member can propose concrete commands and validation steps, but execution stays with the user.",
    available: ["Conversation", "plans", "command recommendations"],
    approvals: ["Memory saves", "task delegation"],
    blocked: ["Command execution", "file edits", "remote writes", "destructive shell"],
  },
  {
    id: "run-read-only",
    rank: 3,
    label: "Run read-only",
    shortLabel: "Read-only",
    icon: TerminalSquare,
    permissionMode: "restricted",
    launchPolicy: "restricted",
    summary: "The member can inspect the selected repository and run read-only checks while write surfaces stay gated.",
    available: ["File read", "code search", "read-only shell", "local browser verification"],
    approvals: ["External web lookup", "build/test commands", "connectors"],
    blocked: ["File edits", "git writes", "PR creation", "destructive shell"],
  },
  {
    id: "edit-files",
    rank: 4,
    label: "Edit files",
    shortLabel: "Edit",
    icon: FileCode2,
    permissionMode: "interactive",
    launchPolicy: "ask",
    summary: "The member can make scoped workspace edits and run validation while sensitive or remote actions ask first.",
    available: ["Read/search", "scoped patches", "build/test", "local browser verification"],
    approvals: ["Dependency installs", "outside workspace access", "git writes", "external web lookup"],
    blocked: ["Destructive shell", "direct merge actions", "auto-merge"],
  },
  {
    id: "open-pr",
    rank: 5,
    label: "Open PR",
    shortLabel: "PR",
    icon: GitBranch,
    permissionMode: "interactive",
    launchPolicy: "ask",
    summary: "The member can prepare PR-ready work, with GitHub and push actions requiring approval and connector readiness.",
    available: ["Edit workflow", "branch preparation", "draft PR readiness"],
    approvals: ["GitHub connector use", "git push", "draft PR creation", "remote CI inspection"],
    blocked: ["Auto-merge", "direct merge", "destructive shell"],
  },
  {
    id: "auto-merge-disabled",
    rank: 6,
    label: "Auto-merge disabled",
    shortLabel: "No merge",
    icon: LockKeyhole,
    permissionMode: "interactive",
    launchPolicy: "ask",
    summary: "The top delegated level still leaves merge authority with the user; PR work can be prepared but never auto-merged.",
    available: ["Everything through PR readiness", "saved approval policy checks", "release evidence"],
    approvals: ["Draft PR creation", "remote writes", "connector access"],
    blocked: ["Auto-merge", "merge commits", "branch rewrites", "destructive shell"],
  },
];

const AUTONOMY_LADDER_LEVEL_IDS = AUTONOMY_LADDER_LEVELS.map((level) => level.id);
const PR_READY_LADDER_LEVELS = new Set(["open-pr", "auto-merge-disabled"]);
const MERGE_BLOCKED_TOOLS = new Set([
  "git_merge",
  "git_merge_abort",
  "git_rebase",
  "git_rebase_abort",
  "git_rebase_continue",
  "git_rebase_skip",
  "git_reset",
]);

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

const DEFAULT_PROVIDER_DEFINITIONS = [
  { id: "openrouter", label: "OpenRouter", kind: "cloud", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", requiresApiKey: true },
  { id: "openai", label: "OpenAI", kind: "cloud", baseUrl: "https://api.openai.com/v1", model: "gpt-5", requiresApiKey: true },
  { id: "ollama", label: "Ollama", kind: "local", baseUrl: "http://127.0.0.1:11434", model: "llama3.1", requiresApiKey: false },
  { id: "bedrock", label: "Amazon Bedrock", kind: "cloud", baseUrl: "", model: "", requiresApiKey: false },
  { id: "llmgateway", label: "LLM Gateway", kind: "cloud", baseUrl: "", model: "", requiresApiKey: true },
  { id: "deepseek", label: "DeepSeek", kind: "cloud", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", requiresApiKey: true },
  { id: "zai", label: "Z.ai", kind: "cloud", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.5", requiresApiKey: true },
  { id: "nvidia", label: "NVIDIA", kind: "cloud", baseUrl: "https://integrate.api.nvidia.com/v1", model: "", requiresApiKey: true },
  { id: "cerebras", label: "Cerebras", kind: "cloud", baseUrl: "https://api.cerebras.ai/v1", model: "", requiresApiKey: true },
];

function providerDefinitionsFromSettings(settings) {
  return Array.isArray(settings?.definitions) && settings.definitions.length ? settings.definitions : DEFAULT_PROVIDER_DEFINITIONS;
}

function providerDefinition(settings, providerId) {
  return providerDefinitionsFromSettings(settings).find((item) => item.id === providerId) || DEFAULT_PROVIDER_DEFINITIONS.find((item) => item.id === providerId);
}

function normalizeModelAssignment(assignment) {
  if (!assignment || typeof assignment !== "object" || assignment.mode !== "override") return { mode: "inherit" };
  const provider = MODEL_PROVIDER_OPTIONS.includes(assignment.provider) ? assignment.provider : "openrouter";
  return {
    mode: "override",
    provider,
    model: String(assignment.model || "").trim(),
  };
}

function modelAssignmentForAgent(agent) {
  const direct = normalizeModelAssignment(agent?.modelAssignment);
  if (direct.mode === "override") return direct;
  const permissions = normalizePermissionState(agent?.permissions);
  if (permissions.modelSecurityEnabled && permissions.modelSecurity.model) {
    return {
      mode: "override",
      provider: permissions.modelSecurity.provider,
      model: permissions.modelSecurity.model,
    };
  }
  return { mode: "inherit" };
}

function providerIsConfigured(settings, providerId) {
  const provider = settings?.providers?.[providerId];
  if (!provider?.enabled) return false;
  const definition = providerDefinition(settings, providerId);
  if (definition?.requiresApiKey && !provider.apiKeyConfigured) return false;
  return Boolean(provider.model);
}

function effectiveModelForAgent(agent, settings) {
  const assignment = modelAssignmentForAgent(agent);
  const providerId = assignment.mode === "override" ? assignment.provider : settings?.defaultProvider || "openrouter";
  const provider = settings?.providers?.[providerId];
  const definition = providerDefinition(settings, providerId);
  return {
    source: assignment.mode === "override" ? "agent" : "workspace",
    provider: providerId,
    label: definition?.label || providerId,
    model: assignment.mode === "override" ? assignment.model : provider?.model || definition?.model || "",
    configured: providerIsConfigured(settings, providerId),
  };
}

function providerSummaryLabel(model) {
  if (!model) return "No model selected";
  const label = model.label || model.provider || "Provider";
  return model.model ? `${label} / ${model.model}` : label;
}

function defaultProviderSettings(reason = "") {
  const providers = Object.fromEntries(
    DEFAULT_PROVIDER_DEFINITIONS.map((definition) => [
      definition.id,
      {
        id: definition.id,
        enabled: definition.id === "openrouter",
        apiKey: "",
        apiKeyConfigured: false,
        requiresApiKey: definition.requiresApiKey,
        label: definition.label,
        kind: definition.kind,
        baseUrl: definition.baseUrl || "",
        model: definition.model || "",
        region: "",
        profile: "",
      },
    ])
  );
  return {
    version: 1,
    defaultProvider: "openrouter",
    definitions: DEFAULT_PROVIDER_DEFINITIONS,
    providers,
    updatedAt: "",
    bridgeUnavailable: Boolean(reason),
    bridgeUnavailableReason: reason,
  };
}

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
  { id: "model", label: "Model", icon: Brain },
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
    title: "Personality",
    badge: "Personality",
    fileName: "PERSONALITY.md",
    aliases: ["PERSONA.md"],
    uploadLabel: "Upload personality.md",
    placeholder:
      "Describe personality, tone, collaboration style, defaults, escalation rules, and how this squad member should interact with people.",
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

const BRAIN_CARD_RECOMMENDATION_FIELD = {
  id: "whyThisAgent",
  label: "Why this agent?",
  prompt: "The recommendation text shown when this squad member is selected for a task or handoff.",
};

const BRAIN_CARD_EDIT_FIELDS = [...brainCardFields, BRAIN_CARD_RECOMMENDATION_FIELD];

const BRAIN_CARD_PROFILE_SECTION = {
  id: "brain-card",
  title: "Brain Card",
  badge: "Brain Card",
  fileName: "BRAIN_CARD.md",
  uploadLabel: "Upload brain-card.md",
  placeholder: "Generated from the structured brain card fields.",
};

const createEmptyCustomRoleDraft = () => ({
  title: "",
  description: "",
  avatar: "",
  mode: "upload",
  sections: CUSTOM_ROLE_SECTIONS.reduce((acc, section) => ({ ...acc, [section.id]: "" }), {}),
  sectionFileNames: CUSTOM_ROLE_SECTIONS.reduce((acc, section) => ({ ...acc, [section.id]: "" }), {}),
  brainCard: BRAIN_CARD_EDIT_FIELDS.reduce((acc, field) => ({ ...acc, [field.id]: "" }), {}),
  skillsText: "",
  mcpText: "",
});

function autonomyLadderLevelMeta(levelId) {
  const normalized = String(levelId || "").trim();
  return AUTONOMY_LADDER_LEVELS.find((level) => level.id === normalized) ||
    AUTONOMY_LADDER_LEVELS.find((level) => level.id === DEFAULT_AUTONOMY_LADDER_LEVEL) ||
    AUTONOMY_LADDER_LEVELS[0];
}

function autonomyLadderRank(levelId) {
  return autonomyLadderLevelMeta(levelId).rank;
}

// Goal 09: Run Recipes — catalog access + recommendation + done-criteria
// helpers. Recipes are read-only built-in data for now; user CRUD is post-MVP.
const RECIPE_CATALOG = Array.isArray(initialRecipes) ? initialRecipes : [];

function findRecipeById(recipeId) {
  const normalized = String(recipeId || "").trim();
  if (!normalized) return null;
  return RECIPE_CATALOG.find((recipe) => recipe.id === normalized) || null;
}

function recipeAppliesToRole(recipe, roleId) {
  if (!recipe) return false;
  if (!recipe.roleId) return true; // role-agnostic recipes apply everywhere
  const normalized = String(roleId || "").trim();
  return Boolean(normalized) && recipe.roleId === normalized;
}

// Recipes scoped to a role (plus all role-agnostic recipes). Role-specific
// recipes sort first so a member sees its specialty workflows at the top.
function findRecipesForRole(roleId) {
  return RECIPE_CATALOG.filter((recipe) => recipeAppliesToRole(recipe, roleId)).sort((a, b) => {
    const aRole = a.roleId ? 0 : 1;
    const bRole = b.roleId ? 0 : 1;
    return aRole - bRole;
  });
}

function agentRoleId(agent) {
  return String(agent?.employeeType || agent?.id || "").trim();
}

function recommendedRecipes(agent) {
  return findRecipesForRole(agentRoleId(agent));
}

// Keyword matcher: score recipes against the user's request and surface the
// strongest matches. Role-applicable recipes get a small boost so a member's
// own specialty recipes win ties. Returns recipes annotated with a reason.
function recommendRecipesForPrompt(prompt, recipes = RECIPE_CATALOG, agentRole = "") {
  const text = String(prompt || "").toLowerCase();
  if (!text.trim()) return [];
  const role = String(agentRole || "").trim();
  const scored = recipes
    .map((recipe) => {
      const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
      const matched = tags.filter((tag) => tag && text.includes(String(tag).toLowerCase()));
      let score = matched.length;
      if (score && recipeAppliesToRole(recipe, role) && recipe.roleId) score += 0.5;
      return { recipe, score, matched };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((entry) => ({ ...entry.recipe, matchedKeywords: entry.matched }));
}

// Derive the launch payload overrides a recipe imposes: model, run mode, and
// the policy implied by its permission ladder level. Existing run modes stay
// available when no recipe is selected.
function recipeLaunchOverrides(recipe) {
  if (!recipe) return null;
  const level = autonomyLadderLevelMeta(recipe.permissionLevel);
  return {
    mode: "goal",
    policy: level.launchPolicy || "restricted",
    model: recipe.model || "",
    permissionLevel: level.id,
  };
}

// Goal 09: map a recipe's expected evidence to what the run actually captured.
// Reads the normalized evidence timeline so it stays in sync with the timeline
// view rather than inventing a parallel source.
function recipeEvidenceCoverage(recipe, row) {
  const expected = Array.isArray(recipe?.expectedEvidence) ? recipe.expectedEvidence : [];
  if (!expected.length) return { expected: [], captured: [], items: [], capturedCount: 0 };
  const events = taskEvidenceTimeline(row);
  const present = new Set(events.map((event) => event.evidenceType));
  const items = expected.map((type) => ({ type, captured: present.has(type) }));
  const capturedCount = items.filter((item) => item.captured).length;
  return {
    expected,
    captured: items.filter((item) => item.captured).map((item) => item.type),
    items,
    capturedCount,
  };
}

// Evaluate a recipe's done criteria against a completed task/run. Each criterion
// passes when every evidence type it requires appears in the timeline. Never
// invents a pass: missing evidence is a deterministic fail. Returns a stable
// shape suitable for storing on task.recipeDoneCriteriaResults.
function evaluateRecipeDoneCriteria(task, run) {
  const recipe = findRecipeById(task?.recipeId || run?.recipeId);
  if (!recipe) return null;
  const row = { task, run };
  const events = taskEvidenceTimeline(row);
  const present = new Set(events.map((event) => event.evidenceType));
  const criteria = Array.isArray(recipe.doneCriteria) ? recipe.doneCriteria : [];
  const results = criteria.map((criterion) => {
    const required = Array.isArray(criterion.evidence) ? criterion.evidence : [];
    const missing = required.filter((type) => !present.has(type));
    return {
      id: criterion.id,
      label: criterion.label,
      required,
      missing,
      state: missing.length ? "fail" : "pass",
    };
  });
  const passed = results.filter((item) => item.state === "pass").length;
  return {
    recipeId: recipe.id,
    evaluatedAt: new Date().toISOString(),
    passed,
    total: results.length,
    summaryState: results.length && passed === results.length ? "all-pass" : passed ? "some-fail" : "incomplete",
    results,
  };
}

function toolModesForAutonomyLadder(levelId) {
  const rank = autonomyLadderRank(levelId);
  const modes = Object.fromEntries(CLI_TOOL_PERMISSIONS.map((item) => [item.id, "block"]));
  const setMode = (toolIds, mode) => {
    for (const toolId of toolIds) {
      if (Object.prototype.hasOwnProperty.call(modes, toolId)) {
        modes[toolId] = mode;
      }
    }
  };

  if (rank >= 3) {
    setMode(["shell.read", "file.read", "search.text", "browser.local"], "allow");
    setMode(["shell.dev", "web.fetch", "mcp.connectors"], "ask");
  }

  if (rank >= 4) {
    setMode(["shell.dev", "patch.apply"], "allow");
    setMode(["shell.package", "shell.git_write", "workspace.outside", "web.fetch", "github.remote", "mcp.connectors"], "ask");
  }

  if (rank >= 5) {
    setMode(["github.remote", "shell.git_write"], "ask");
  }

  setMode(["shell.destructive"], "block");
  return modes;
}

function builtInPoliciesForAutonomyLadder(levelId) {
  const rank = autonomyLadderRank(levelId);
  const policies = Object.fromEntries(Object.keys(DEFAULT_BUILT_IN_TOOL_POLICIES).map((tool) => [tool, "block"]));
  const setTools = (tools, mode) => {
    for (const tool of tools) {
      if (Object.prototype.hasOwnProperty.call(policies, tool)) {
        policies[tool] = mode;
      }
    }
  };
  const setGroup = (groupId, mode) => {
    const group = BUILT_IN_TOOL_POLICY_GROUPS.find((item) => item.id === groupId);
    setTools((group?.tools || []).map(([tool]) => tool), mode);
  };

  setTools(
    [
      "tools_registry",
      "tool_search",
      "ask_followup_question",
      "plan",
      "list_goal_templates",
      "recall_memory",
      "smart_context_cropper",
      "team_status",
    ],
    "allow"
  );
  setTools(
    [
      "create_goal",
      "create_goal_from_template",
      "update_goal",
      "clear_goal",
      "enqueue_goal",
      "dequeue_goal",
      "remove_queued_goal",
      "save_memory",
      "delegate_task",
      "delegate_parallel",
      "create_team",
      "add_teammate",
      "send_team_message",
      "create_meta_tool",
    ],
    "ask"
  );

  if (rank >= 3) {
    setGroup("filesystem-read", "allow");
    setGroup("git-read", "allow");
    setTools(
      [
        "package_info",
        "browser_screenshot",
        "browser_navigate",
        "browser_get_page_context",
        "browser_get_element",
        "browser_find_element",
        "browser_wait_for_element",
        "browser_read_network",
        "browser_read_console",
        "task_get",
        "task_list",
        "sleep",
        "list_schedules",
        "project_tracker",
        "code_review",
      ],
      "allow"
    );
    setTools(
      [
        "shell",
        "run_command",
        "custom_command",
        "web_search",
        "fetch_url",
        "web_repo",
        "browser_click",
        "browser_type",
        "browser_scroll",
        "browser_press_key",
        "browser_execute_js",
        "request_directory_access",
      ],
      "ask"
    );
  }

  if (rank >= 4) {
    setGroup("filesystem-write", "ask");
    setGroup("tasks-automation", "ask");
    setTools(["apply_patch", "format_file", "search_replace", "create_directory"], "allow");
    setTools(["delete_path", "remove_dependency"], "block");
  }

  if (rank >= 5) {
    setGroup("git-write", "ask");
    setGroup("workspace-meta", "ask");
    setTools(["exit_worktree", "project_tracker", "code_review"], "allow");
    setTools(["git_push", "git_worktree_create_for_pr", "git_worktree_create_from_template"], "ask");
  }

  setTools([...MERGE_BLOCKED_TOOLS], "block");
  setTools(["delete_path", "git_reset"], "block");
  return policies;
}

function permissionPresetForAutonomyLadder(levelId) {
  const level = autonomyLadderLevelMeta(levelId);
  return {
    ladderLevel: level.id,
    profile: level.id,
    permissionMode: level.permissionMode,
    rememberSession: true,
    toolGuardEnabled: true,
    fileGuardEnabled: true,
    builtInToolPolicyEnabled: true,
    modelSecurityEnabled: false,
    shellReviewEnabled: true,
    shellEvasionEnabled: true,
    allPathsAllowed: false,
    allUrlsAllowed: false,
    modes: toolModesForAutonomyLadder(level.id),
    builtInPolicies: builtInPoliciesForAutonomyLadder(level.id),
  };
}

function createDefaultPermissionState() {
  const preset = permissionPresetForAutonomyLadder(DEFAULT_AUTONOMY_LADDER_LEVEL);
  return {
    ...preset,
    toolGuardRules: Object.fromEntries(TOOL_GUARD_RULE_GROUPS.flatMap((group) => group.rules.map(([id]) => [id, true]))),
    shellEvasionRules: Object.fromEntries(SHELL_EVASION_RULES.map(([id]) => [id, true])),
    sensitivePaths: [...DEFAULT_SENSITIVE_PATHS],
    workspaceOverrides: {},
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

function normalizePermissionWorkspaceOverrides(overrides) {
  if (!overrides || typeof overrides !== "object") return {};
  const normalized = {};
  for (const [workspace, override] of Object.entries(overrides)) {
    const key = normalizePath(workspace);
    if (!key || !override || typeof override !== "object") continue;
    normalized[key] = normalizePermissionState({ ...override, workspaceOverrides: undefined }, { includeWorkspaceOverrides: false });
  }
  return normalized;
}

function normalizePermissionState(permissions, options = {}) {
  const defaults = createDefaultPermissionState();
  const source = permissions && typeof permissions === "object" ? permissions : {};
  const ladderLevel = autonomyLadderLevelMeta(source.ladderLevel || source.profile || defaults.ladderLevel).id;
  const ladderDefaults = {
    ...defaults,
    ...permissionPresetForAutonomyLadder(ladderLevel),
    modelSecurity: defaults.modelSecurity,
    toolGuardRules: defaults.toolGuardRules,
    shellEvasionRules: defaults.shellEvasionRules,
    sensitivePaths: defaults.sensitivePaths,
    workspaceOverrides: defaults.workspaceOverrides,
  };
  const modes = source.modes && typeof source.modes === "object" ? source.modes : {};
  const builtInPolicies = source.builtInPolicies && typeof source.builtInPolicies === "object"
    ? source.builtInPolicies
    : {};
  const toolGuardRules = source.toolGuardRules && typeof source.toolGuardRules === "object"
    ? source.toolGuardRules
    : {};
  const shellEvasionRules = source.shellEvasionRules && typeof source.shellEvasionRules === "object"
    ? source.shellEvasionRules
    : {};
  const normalizedModes = { ...ladderDefaults.modes };
  for (const item of CLI_TOOL_PERMISSIONS) {
    const value = modes[item.id];
    normalizedModes[item.id] = PERMISSION_LEVELS.some((level) => level.id === value) ? value : ladderDefaults.modes[item.id];
  }
  const normalizedBuiltInPolicies = { ...ladderDefaults.builtInPolicies };
  for (const tool of Object.keys(DEFAULT_BUILT_IN_TOOL_POLICIES)) {
    const value = builtInPolicies[tool];
    normalizedBuiltInPolicies[tool] = PERMISSION_LEVELS.some((level) => level.id === value)
      ? value
      : ladderDefaults.builtInPolicies[tool];
  }
  const normalizedToolGuardRules = { ...ladderDefaults.toolGuardRules };
  for (const id of Object.keys(ladderDefaults.toolGuardRules)) {
    normalizedToolGuardRules[id] = typeof toolGuardRules[id] === "boolean" ? toolGuardRules[id] : ladderDefaults.toolGuardRules[id];
  }
  const normalizedShellEvasionRules = { ...ladderDefaults.shellEvasionRules };
  for (const id of Object.keys(ladderDefaults.shellEvasionRules)) {
    normalizedShellEvasionRules[id] = typeof shellEvasionRules[id] === "boolean" ? shellEvasionRules[id] : ladderDefaults.shellEvasionRules[id];
  }

  return {
    ...ladderDefaults,
    ...source,
    ladderLevel,
    profile: String(source.profile || ladderDefaults.profile),
    modes: normalizedModes,
    builtInPolicies: normalizedBuiltInPolicies,
    toolGuardRules: normalizedToolGuardRules,
    shellEvasionRules: normalizedShellEvasionRules,
    workspaceOverrides: options.includeWorkspaceOverrides === false
      ? {}
      : normalizePermissionWorkspaceOverrides(source.workspaceOverrides),
    sensitivePaths: Array.isArray(source.sensitivePaths)
      ? Array.from(new Set(source.sensitivePaths.map((item) => String(item || "").trim()).filter(Boolean)))
      : ladderDefaults.sensitivePaths,
    modelSecurity: {
      ...ladderDefaults.modelSecurity,
      ...(source.modelSecurity && typeof source.modelSecurity === "object" ? source.modelSecurity : {}),
    },
    permissionMode: CLI_PERMISSION_MODE_OPTIONS.some((mode) => mode.id === source.permissionMode)
      ? source.permissionMode
      : ladderDefaults.permissionMode,
    rememberSession: source.rememberSession ?? ladderDefaults.rememberSession,
    toolGuardEnabled: source.toolGuardEnabled ?? ladderDefaults.toolGuardEnabled,
    fileGuardEnabled: source.fileGuardEnabled ?? ladderDefaults.fileGuardEnabled,
    builtInToolPolicyEnabled: source.builtInToolPolicyEnabled ?? ladderDefaults.builtInToolPolicyEnabled,
    modelSecurityEnabled: source.modelSecurityEnabled ?? ladderDefaults.modelSecurityEnabled,
    shellReviewEnabled: source.shellReviewEnabled ?? ladderDefaults.shellReviewEnabled,
    shellEvasionEnabled: source.shellEvasionEnabled ?? ladderDefaults.shellEvasionEnabled,
    allPathsAllowed: source.allPathsAllowed ?? ladderDefaults.allPathsAllowed,
    allUrlsAllowed: source.allUrlsAllowed ?? ladderDefaults.allUrlsAllowed,
  };
}

function permissionLevelMeta(mode) {
  return PERMISSION_LEVELS.find((level) => level.id === mode) || PERMISSION_LEVELS[1];
}

function permissionWorkspaceKey(workspace) {
  return normalizePath(workspace);
}

function resolveAgentPermissionsForWorkspace(agent, workspace) {
  const base = normalizePermissionState(agent?.permissions);
  const key = permissionWorkspaceKey(workspace || agent?.workspace);
  const override = key ? base.workspaceOverrides[key] : null;
  if (!override) return base;
  return normalizePermissionState({
    ...base,
    ...override,
    workspaceOverrides: base.workspaceOverrides,
  });
}

function permissionOverrideForWorkspace(permissions, workspace, nextPermissions) {
  const base = normalizePermissionState(permissions);
  const key = permissionWorkspaceKey(workspace);
  const normalizedNext = normalizePermissionState(nextPermissions, { includeWorkspaceOverrides: false });
  if (!key) {
    return normalizePermissionState({
      ...base,
      ...normalizedNext,
      workspaceOverrides: base.workspaceOverrides,
    });
  }
  return normalizePermissionState({
    ...base,
    workspaceOverrides: {
      ...base.workspaceOverrides,
      [key]: normalizedNext,
    },
  });
}

function permissionOverrideCount(permissions) {
  return Object.keys(normalizePermissionState(permissions).workspaceOverrides).length;
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

function normalizeOnboardingState(value) {
  const source = value && typeof value === "object" ? value : {};
  const status = [ONBOARDING_STATUS_ACTIVE, ONBOARDING_STATUS_COMPLETED, ONBOARDING_STATUS_SKIPPED].includes(source.status)
    ? source.status
    : ONBOARDING_STATUS_ACTIVE;
  return {
    version: ONBOARDING_VERSION,
    status,
    selectedWorkspace: String(source.selectedWorkspace || "").trim(),
    memberReady: source.memberReady === true,
    lastStep: String(source.lastStep || "welcome").trim() || "welcome",
    updatedAt: source.updatedAt || "",
  };
}

function readOnboardingState() {
  return normalizeOnboardingState(readStored(storageKeysFor("onboarding"), null));
}

function onboardingIsIncomplete(state) {
  return ![ONBOARDING_STATUS_COMPLETED, ONBOARDING_STATUS_SKIPPED].includes(state?.status);
}

function onboardingProviderReady(providerSettings) {
  return Boolean(providerSettings && providerIsConfigured(providerSettings, providerSettings.defaultProvider));
}

function onboardingAccountReady(runtime) {
  return runtime?.account?.signedIn === true;
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

const DEFAULT_CHAT_SETTINGS = {
  displayCliOutput: false,
};

function normalizeChatSettings(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    displayCliOutput: source.displayCliOutput === true,
  };
}

function readChatSettings() {
  return normalizeChatSettings(readStored(storageKeysFor("chatSettings"), DEFAULT_CHAT_SETTINGS));
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

function roleTemplateForAgent(agent) {
  const employeeType = String(agent?.employeeType || agent?.id || "").trim();
  const role = String(agent?.role || agent?.title || "").trim().toLowerCase();
  return (
    roleTemplates.find((template) => template.id === employeeType) ||
    roleTemplates.find((template) => template.title.toLowerCase() === role) ||
    null
  );
}

function genericBrainCardForAgent(agent = {}) {
  const role = String(agent?.role || agent?.title || "Squad member").trim();
  const description = String(agent?.description || "").trim();
  const instructions = String(agent?.instructions || agent?.starter || "").trim();
  const skills = normalizeSkillList(agent?.skills);
  return {
    purpose: description || `Operate as ${role} for the selected local workspace.`,
    defaultWorkflow: [
      "1. Inspect the active workspace and task context before acting.",
      "2. Clarify assumptions when role scope or ownership is ambiguous.",
      "3. Work in small scoped increments using the role's standards.",
      "4. Validate with the strongest local evidence available.",
      "5. Report outcome, evidence, and remaining risk clearly.",
    ].join("\n"),
    allowedTools: [
      "- Autohand CLI inside this squad member's isolated home.",
      "- Local read/search/edit/build/test tools allowed by the current permission policy.",
      skills.length ? skills.map((skill) => `- ${skill}`).join("\n") : "- Installed profile skills when they match the task.",
    ].join("\n"),
    escalationRules: [
      "- Ask before destructive changes, secret access, or crossing repository boundaries.",
      "- Hand off when another squad member has clearer ownership.",
      "- Stop and surface blockers when credentials, runtime services, or product decisions are missing.",
    ].join("\n"),
    definitionOfDone: [
      "- The requested behavior or artifact is complete.",
      "- Role-specific risks have been checked.",
      "- Validation evidence is captured.",
      "- Remaining uncertainty is named.",
    ].join("\n"),
    reviewStyle: instructions || `Review work through the standards expected of a ${role}.`,
    memoryPolicy:
      "Propose durable memory only for stable role preferences, project facts, repeated decisions, or verified constraints. Keep secrets, temporary logs, speculative findings, and one-off session details out of durable memory unless the app promotes them through the memory flow.",
    whyThisAgent: `Choose this squad member when the task needs ${role} judgment and its configured skills.`,
  };
}

function normalizeBrainCard(input, agent = {}) {
  const template = roleTemplateForAgent(agent);
  const fallback = template?.brainCard || genericBrainCardForAgent(agent);
  const source = input && typeof input === "object" ? input : {};
  const normalized = {};
  for (const field of brainCardFields) {
    normalized[field.id] = String(source[field.id] || fallback[field.id] || "").trim();
  }
  normalized.whyThisAgent = String(source.whyThisAgent || fallback.whyThisAgent || genericBrainCardForAgent(agent).whyThisAgent).trim();
  return normalized;
}

function brainCardForAgent(agent) {
  return normalizeBrainCard(agent?.brainCard, agent);
}

function markdownSection(title, body) {
  return [`## ${title}`, String(body || "").trim() || "Not configured."].join("\n\n");
}

function buildBrainCardProfileContent(agent) {
  const brainCard = brainCardForAgent(agent);
  const name = agent?.name || "Squad member";
  const role = agent?.role || "Software engineering agent";
  return [
    "# Brain Card",
    `Agent: ${name}`,
    `Role: ${role}`,
    ...brainCardFields.map((field) => markdownSection(field.label, brainCard[field.id])),
    markdownSection("Why this agent?", brainCard.whyThisAgent),
  ].join("\n\n");
}

function formatBrainCardForPrompt(agent) {
  const brainCard = brainCardForAgent(agent);
  return [
    "Brain card fields for this run:",
    ...brainCardFields.map((field) => `${field.label}:\n${brainCard[field.id]}`),
    `Why this agent?:\n${brainCard.whyThisAgent}`,
  ].join("\n\n");
}

function normalizeAgentCopy(agent) {
  if (!agent || typeof agent !== "object") return agent;
  const projects = normalizeAgentProjects(agent.projects, agent.workspace);
  const brainCard = normalizeBrainCard(agent.brainCard, agent);
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
    modelAssignment: normalizeModelAssignment(agent.modelAssignment),
    projects,
    brainCard,
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

function mergeRecordsById(seedRecords, storedRecords) {
  const seedList = Array.isArray(seedRecords) ? seedRecords : [];
  const storedList = Array.isArray(storedRecords) ? storedRecords : [];
  const storedWithoutId = storedList.filter((item) => !String(item?.id || ""));
  const storedById = new Map(storedList.map((item) => [String(item?.id || ""), item]).filter(([id]) => id));
  const merged = seedList.map((seed) => {
    const stored = storedById.get(String(seed?.id || ""));
    if (!stored) return seed;
    storedById.delete(String(seed?.id || ""));
    return { ...seed, ...stored };
  });
  return [...merged, ...storedWithoutId, ...storedById.values()];
}

function createMemoryProposalId() {
  return `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMemoryScope(scope) {
  return MEMORY_SCOPES.some((item) => item.id === scope) ? scope : "personal";
}

function normalizeMemoryStatus(status) {
  return MEMORY_STATUSES.includes(status) ? status : "pending";
}

function normalizeMemoryProjectIdentity(item = {}) {
  const source = item.source && typeof item.source === "object" ? item.source : {};
  const key = normalizePath(
    item.projectKey ||
      item.projectWorkspace ||
      item.workspace ||
      source.projectKey ||
      source.projectWorkspace ||
      source.workspace ||
      ""
  );
  const label = String(item.projectLabel || source.projectLabel || workspaceName(key) || key || "").trim();
  return {
    projectKey: key,
    projectLabel: label,
  };
}

function normalizeMemoryProposal(item, fallbackAgentId = initialAgents[0]?.id) {
  if (!item || typeof item !== "object") return null;
  const content = String(item.content || item.editedContent || item.proposedContent || "").trim();
  if (!content) return null;
  const status = normalizeMemoryStatus(item.status);
  const createdAt = String(item.createdAt || item.proposedAt || new Date().toISOString());
  const ownerAgentId = normalizeSquadMemberId(item.ownerAgentId || item.agentId || fallbackAgentId);
  const confidence = Number(item.confidence);
  const source = item.source && typeof item.source === "object" ? item.source : {};
  const project = normalizeMemoryProjectIdentity(item);
  return {
    id: String(item.id || createMemoryProposalId()),
    agentId: normalizeSquadMemberId(item.agentId || ownerAgentId || fallbackAgentId),
    ownerAgentId,
    status,
    scope: normalizeMemoryScope(item.scope),
    content,
    originalContent: String(item.originalContent || item.proposedContent || content).trim(),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    confidenceRationale: String(item.confidenceRationale || item.rationale || "").trim(),
    source: {
      type: ["conversation", "task", "run", "system"].includes(source.type) ? source.type : "conversation",
      id: String(source.id || ""),
      label: String(source.label || source.id || "Source"),
      agentId: normalizeSquadMemberId(source.agentId || ownerAgentId || fallbackAgentId),
    },
    projectKey: project.projectKey,
    projectLabel: project.projectLabel,
    evidence: String(item.evidence || item.supportingEvidence || "").trim(),
    rejectReason: String(item.rejectReason || "").trim(),
    editHistory: Array.isArray(item.editHistory) ? item.editHistory : [],
    isHidden: item.isHidden === true,
    acceptedAt: item.acceptedAt || "",
    rejectedAt: item.rejectedAt || "",
    updatedAt: String(item.updatedAt || item.acceptedAt || item.rejectedAt || createdAt),
  };
}

function normalizeMemoryInboxCopy(items, defaultAgentId = initialAgents[0]?.id) {
  return (Array.isArray(items) ? items : initialMemoryInbox)
    .map((item) => normalizeMemoryProposal(item, defaultAgentId))
    .filter(Boolean);
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
  const seedById = new Map(initialTasks.map((task) => [String(task.id || ""), task]));
  const enrichedRecords = records.map((record) => {
    const seed = seedById.get(String(record?.id || ""));
    if (!seed) return record;
    return {
      ...seed,
      ...record,
      assignments: mergeRecordsById(seed.assignments, record.assignments),
      handoffs: mergeRecordsById(seed.handoffs, record.handoffs),
      timeline: mergeRecordsById(seed.timeline, record.timeline),
    };
  });
  const seen = new Set(enrichedRecords.map((task) => String(task?.id || "")).filter(Boolean));
  return [
    ...initialTasks.filter((task) => !seen.has(String(task.id || ""))),
    ...enrichedRecords,
  ];
}

function mergeSeedMemoryInbox(storedItems) {
  const records = normalizeMemoryInboxCopy(storedItems);
  const seen = new Set(records.map((item) => item.id));
  return [
    ...initialMemoryInbox.filter((item) => !seen.has(String(item.id || ""))),
    ...records,
  ]
    .map((item) => normalizeMemoryProposal(item))
    .filter(Boolean);
}

function memberChatPath(memberId) {
  const normalizedId = normalizeSquadMemberId(memberId);
  return normalizedId ? `/conversations/new?member=${encodeURIComponent(normalizedId)}` : "/conversations/new";
}

function channelsPath(channelId = "") {
  return channelId ? `${CHANNELS_ROUTE}/${encodeURIComponent(channelId)}` : CHANNELS_ROUTE;
}

function channelIdFromRoute(route) {
  const match = String(route || "").split("?")[0].match(/^\/channels\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

// Squad channels: normalization keeps legacy/partial localStorage records
// usable — missing fields fall back to safe defaults and auto mode (self-judge)
// only turns on when explicitly stored as true.
function normalizeChannelCopy(channel) {
  if (!channel || typeof channel !== "object") return null;
  const name = String(channel.name || "").trim();
  const id = String(channel.id || "").trim();
  if (!id || !name) return null;
  const createdAt = String(channel.createdAt || new Date().toISOString());
  const memberIds = Array.isArray(channel.memberIds)
    ? Array.from(new Set(channel.memberIds.map((memberId) => String(memberId || "").trim()).filter(Boolean)))
    : [];
  return {
    id,
    name: name.slice(0, 80),
    visibility: channel.visibility === CHANNEL_VISIBILITY_PRIVATE ? CHANNEL_VISIBILITY_PRIVATE : CHANNEL_VISIBILITY_PUBLIC,
    memberIds,
    creatorId: String(channel.creatorId || "").trim(),
    autoModeDefault: channel.autoModeDefault === true,
    createdAt,
    updatedAt: String(channel.updatedAt || createdAt),
  };
}

function mergeSeedChannels(stored) {
  const records = (Array.isArray(stored) ? stored : []).map(normalizeChannelCopy).filter(Boolean);
  const seen = new Set(records.map((channel) => channel.id));
  return [
    ...records,
    ...initialChannels.filter((channel) => !seen.has(channel.id)).map(normalizeChannelCopy).filter(Boolean),
    ...RECOVERED_CHANNELS.filter((channel) => !seen.has(channel.id)).map(normalizeChannelCopy).filter(Boolean),
  ];
}

function normalizeChannelThreadCopy(thread) {
  if (!thread || typeof thread !== "object") return null;
  const id = String(thread.id || "").trim();
  const channelId = String(thread.channelId || "").trim();
  if (!id || !channelId) return null;
  const createdAt = String(thread.createdAt || new Date().toISOString());
  return {
    id,
    channelId,
    parentMessageId: String(thread.parentMessageId || "").trim(),
    title: String(thread.title || "").trim().slice(0, 200),
    creatorId: String(thread.creatorId || "").trim(),
    memberIds: Array.isArray(thread.memberIds)
      ? Array.from(new Set(thread.memberIds.map((memberId) => String(memberId || "").trim()).filter(Boolean)))
      : [],
    targetLabel: String(thread.targetLabel || "").trim(),
    autoMode: thread.autoMode === true,
    selfJudge: thread.selfJudge === true,
    replyCount:
      Number.isFinite(Number(thread.replyCount)) && Number(thread.replyCount) > 0
        ? Math.floor(Number(thread.replyCount))
        : 0,
    createdAt,
    updatedAt: String(thread.updatedAt || createdAt),
  };
}

function normalizeChannelThreadsCopy(threadsByChannel) {
  if (!threadsByChannel || typeof threadsByChannel !== "object" || Array.isArray(threadsByChannel)) return {};
  const next = {};
  for (const [channelId, threads] of Object.entries(threadsByChannel)) {
    if (!Array.isArray(threads)) continue;
    const records = threads.map(normalizeChannelThreadCopy).filter(Boolean);
    if (records.length) next[channelId] = records;
  }
  return next;
}

function normalizeChannelMessagesCopy(messagesByChannel) {
  if (!messagesByChannel || typeof messagesByChannel !== "object") return {};
  const next = {};
  const entries = Array.isArray(messagesByChannel) ? [["", messagesByChannel]] : Object.entries(messagesByChannel);
  for (const [channelId, messages] of entries) {
    if (!Array.isArray(messages)) continue;
    for (const message of messages) {
      if (!message || typeof message !== "object" || !message.id) continue;
      const messageChannelId = String(message.channelId || channelId || "").trim();
      if (!messageChannelId) continue;
      next[messageChannelId] = [...(next[messageChannelId] || []), { ...message, channelId: messageChannelId }];
    }
  }
  return next;
}

function mergeSeedChannelThreads(stored) {
  const next = normalizeChannelThreadsCopy(stored);
  for (const seed of RECOVERED_CHANNEL_THREADS.map(normalizeChannelThreadCopy).filter(Boolean)) {
    const existing = next[seed.channelId] || [];
    if (existing.some((thread) => thread.id === seed.id)) continue;
    next[seed.channelId] = [...existing, seed];
  }
  return next;
}

function mergeSeedChannelMessages(stored) {
  const next = normalizeChannelMessagesCopy(stored);
  const seedMessages = normalizeChannelMessagesCopy(RECOVERED_CHANNEL_MESSAGES);
  for (const [channelId, messages] of Object.entries(seedMessages)) {
    const existing = next[channelId] || [];
    const byId = new Map(existing.map((message) => [message.id, message]));
    for (const message of messages) {
      if (!byId.has(message.id)) byId.set(message.id, message);
    }
    next[channelId] = Array.from(byId.values());
  }
  return next;
}

const CHANNEL_MENTION_PATTERN = /@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

function normalizeChannelMentionKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function channelMentionHandle(agent) {
  const name = String(agent?.name || "").trim();
  const firstName = name.split(/\s+/)[0] || "";
  const handle = firstName.replace(/[^A-Za-z0-9._-]/g, "");
  return handle || String(agent?.id || "").replace(/[^A-Za-z0-9._-]/g, "");
}

function channelMentionLabel(agent) {
  const handle = channelMentionHandle(agent);
  return handle ? `@${handle}` : String(agent?.name || "member");
}

function channelMentionAliases(agent) {
  const name = String(agent?.name || "").trim();
  const firstName = name.split(/\s+/)[0] || "";
  return Array.from(
    new Set(
      [name, firstName, name.replace(/\s+/g, ""), channelMentionHandle(agent)]
        .map(normalizeChannelMentionKey)
        .filter(Boolean)
    )
  );
}

function channelMembersFor(channel, agents = []) {
  const channelMemberIds = new Set(Array.isArray(channel?.memberIds) ? channel.memberIds : []);
  return agents.filter((agent) => channelMemberIds.has(agent.id));
}

function channelAgentsByIds(memberIds = [], agents = []) {
  const wanted = new Set((Array.isArray(memberIds) ? memberIds : []).filter(Boolean));
  return agents.filter((agent) => wanted.has(agent.id));
}

function resolveChannelMentionTargets(prompt, channel, agents = [], options = {}) {
  const text = String(prompt || "");
  const channelAgents = channelMembersFor(channel, agents);
  const fallbackAgents = channelAgentsByIds(options.fallbackMemberIds, agents);
  const defaultAgents = fallbackAgents.length ? fallbackAgents : channelAgents;
  const mentionTokens = Array.from(text.matchAll(CHANNEL_MENTION_PATTERN), (match) => String(match[1] || ""))
    .filter(Boolean);
  const uniqueTokens = Array.from(new Set(mentionTokens));
  const hasMentions = uniqueTokens.length > 0;
  if (!hasMentions) {
    return {
      mode: fallbackAgents.length ? "thread" : "channel",
      hasMentions,
      invalidMentionTokens: [],
      targetAgents: defaultAgents,
      targetMemberIds: defaultAgents.map((agent) => agent.id),
      targetLabel: fallbackAgents.length ? "thread recipients" : "channel",
    };
  }

  const aliasBuckets = new Map();
  for (const agent of channelAgents) {
    for (const alias of channelMentionAliases(agent)) {
      aliasBuckets.set(alias, [...(aliasBuckets.get(alias) || []), agent]);
    }
  }

  const selected = new Map();
  const invalidMentionTokens = [];
  const mentionsHere = uniqueTokens.some((token) => normalizeChannelMentionKey(token) === "here");
  if (mentionsHere) {
    for (const agent of channelAgents) selected.set(agent.id, agent);
  }

  for (const token of uniqueTokens) {
    const key = normalizeChannelMentionKey(token);
    if (!key || key === "here") continue;
    const matches = aliasBuckets.get(key) || [];
    if (matches.length === 1) {
      selected.set(matches[0].id, matches[0]);
    } else {
      invalidMentionTokens.push(`@${token}`);
    }
  }

  const targetAgents = Array.from(selected.values());
  const targetLabel = mentionsHere
    ? "@here"
    : targetAgents.length
      ? targetAgents.map(channelMentionLabel).join(", ")
      : "";
  return {
    mode: mentionsHere ? "here" : "mentions",
    hasMentions,
    invalidMentionTokens,
    targetAgents,
    targetMemberIds: targetAgents.map((agent) => agent.id),
    targetLabel,
  };
}

function formatChannelTargetLabel(resolution) {
  if (!resolution?.targetAgents?.length) return "";
  if (resolution.mode === "here") return "@here";
  return resolution.targetAgents.map(channelMentionLabel).join(", ");
}

function sanitizeMarkdownFilename(value) {
  const slug = String(value || "channel")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "channel";
}

function formatMarkdownTimestamp(message, locale = DEFAULT_LOCALE) {
  const value = message?.completedAt || message?.updatedAt || message?.startedAt || message?.createdAt;
  if (!value) return message?.time || "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return message?.time || String(value);
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function channelMessageAuthor(message, agents = [], userName = "You") {
  if (message?.role === "user") return userName;
  const agent = agents.find((item) => item.id === message?.agentId);
  return agent?.name || message?.authorName || "Squad member";
}

function buildChannelMarkdownLog({ channel, threads = [], messages = [], agents = [], userName = "You", locale = DEFAULT_LOCALE }) {
  const channelMembers = channelMembersFor(channel, agents);
  const sortedThreads = [...threads].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const lines = [
    `# #${channel?.name || "channel"}`,
    "",
    `- Visibility: ${channel?.visibility || "public"}`,
    `- Members: ${channelMembers.map((agent) => agent.name).join(", ") || "none"}`,
    `- Exported: ${new Date().toISOString()}`,
    "",
  ];

  if (!sortedThreads.length) {
    lines.push("_No threads recorded._", "");
    return lines.join("\n");
  }

  for (const thread of sortedThreads) {
    const threadMessages = messages
      .filter((message) => message.threadId === thread.id)
      .sort((a, b) =>
        String(a.createdAt || a.startedAt || a.updatedAt || "").localeCompare(String(b.createdAt || b.startedAt || b.updatedAt || ""))
      );
    const targetAgents = channelAgentsByIds(thread.memberIds, agents);
    lines.push(`## ${thread.title || "Untitled thread"}`);
    if (targetAgents.length) {
      lines.push(`_Targets: ${targetAgents.map(channelMentionLabel).join(", ")}_`);
    }
    lines.push("");

    if (!threadMessages.length) {
      lines.push("_No message bodies are loaded for this thread._", "");
      continue;
    }

    for (const message of threadMessages) {
      const author = channelMessageAuthor(message, agents, userName);
      const timestamp = formatMarkdownTimestamp(message, locale);
      const targetAgentsForMessage = channelAgentsByIds(message.targetMemberIds, agents);
      const targetSuffix = targetAgentsForMessage.length
        ? ` to ${targetAgentsForMessage.map(channelMentionLabel).join(", ")}`
        : "";
      const body = humanReadableReplyText(message.body, message.trace, message.body) || "_No message text._";
      lines.push(`**${author}${targetSuffix}${timestamp ? ` (${timestamp})` : ""}:**`);
      lines.push("");
      lines.push(body);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function downloadMarkdownLog(filename, markdown) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function missionControlPath(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const suffix = search.toString();
  return suffix ? `${MISSION_CONTROL_ROUTE}?${suffix}` : MISSION_CONTROL_ROUTE;
}

function squadDirectoryPath() {
  return SQUAD_DIRECTORY_ROUTE;
}

function isMemberRouteForAgent(route, agentId) {
  const normalized = normalizeSquadMemberId(agentId);
  if (!normalized) return false;
  const params = new URLSearchParams(route.split("?")[1] || "");
  const member = normalizeSquadMemberId(params.get("member") || params.get("squadMember"));
  const profileMatch = route.match(/\/squad-members\/([^/?#]+)/);
  const profileId = normalizeSquadMemberId(profileMatch?.[1]);
  return member === normalized || profileId === normalized;
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

function memoryInboxPath(memberId) {
  return memberProfilePath(memberId, "memory");
}

function memorySourceHref(item) {
  const source = item?.source || {};
  const sourceAgentId = normalizeSquadMemberId(source.agentId || item?.ownerAgentId || item?.agentId);
  if (source.type === "task" && source.id) {
    return `${memberProfilePath(sourceAgentId, "task")}?task=${encodeURIComponent(source.id)}`;
  }
  if (source.type === "run" && source.id) {
    return missionControlPath({ run: source.id });
  }
  if (sourceAgentId) {
    return memberChatPath(sourceAgentId);
  }
  return missionControlPath();
}

function projectMemoryPatchForAgent(item, agent, runtime) {
  const existing = normalizeMemoryProjectIdentity(item);
  const workspace = normalizeSquadWorkspacePath(existing.projectKey || agent?.workspace || "", runtime);
  return {
    projectKey: workspace,
    projectLabel: existing.projectLabel || workspaceName(workspace) || agent?.workspace || "",
  };
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
    const route = String(path || "").split("?")[0];
    throw new Error(payload.error || `${route} failed: ${response.status}`);
  }
  return payload.data;
}

function splitRoute(route) {
  const [path, query = ""] = String(route || "/mission-control").split("?");
  return { path: path || "/mission-control", params: new URLSearchParams(query) };
}

function routeWithParams(route, updates = {}) {
  const { path, params } = splitRoute(route);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") {
      params.delete(key);
    } else {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function routeWithoutModalParams(route) {
  return routeWithParams(route, { feedback: null, about: null });
}

function feedbackKindFromRoute(route) {
  const params = splitRoute(route).params;
  const value = params.get("feedback");
  if (value === "bug") return "bug";
  if (value === "feedback") return "feedback";
  return "";
}

function aboutOpenFromRoute(route) {
  return splitRoute(route).params.get("about") === "squad";
}

function collectFeedbackStorageSnapshot() {
  const snapshot = {};
  for (const key of Object.values(STORAGE_KEYS)) {
    try {
      const value = window.localStorage.getItem(key);
      if (value) snapshot[key] = value;
    } catch {
      // Keep feedback capture non-blocking when storage is unavailable.
    }
  }
  return snapshot;
}

function parseServerEventBlock(block) {
  let event = "message";
  const data = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim() || event;
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }

  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) };
  } catch {
    return { event, data: data.join("\n") };
  }
}

async function streamApi(path, options = {}, onEvent) {
  const response = await fetch(path, {
    headers: { accept: "text/event-stream", "content-type": "application/json" },
    ...options,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const parsed = parseServerEventBlock(block);
      if (parsed) onEvent?.(parsed.event, parsed.data);
    }
  }

  buffer += decoder.decode();
  const parsed = parseServerEventBlock(buffer);
  if (parsed) onEvent?.(parsed.event, parsed.data);
}

function isAbortError(error) {
  return error?.name === "AbortError" || String(error?.message || "").toLowerCase().includes("aborted");
}

function createLiveChatTrace() {
  return {
    steps: [],
    thoughts: [],
    toolCalls: [],
    toolResults: [],
    messages: [],
    events: [],
    raw: { stdout: "", stderr: "" },
  };
}

function compactStreamText(value, maxLength = 24000) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n... truncated ...` : text;
}

function upsertTraceItem(items, nextItem, key) {
  const nextKey = key(nextItem);
  const existingIndex = items.findIndex((item) => key(item) === nextKey);
  if (existingIndex === -1) return [...items, nextItem];
  return items.map((item, index) => (index === existingIndex ? { ...item, ...nextItem } : item));
}

function appendRawTraceText(raw, stream, output) {
  const key = stream === "stderr" ? "stderr" : "stdout";
  return {
    ...raw,
    [key]: compactStreamText(`${raw?.[key] || ""}${output || ""}`),
  };
}

function updateLiveTraceFromStreamEvent(trace, event) {
  const current = trace || createLiveChatTrace();
  if (event.type === "message_delta") {
    const raw = event.delta ? appendRawTraceText(current.raw, "stdout", event.delta) : current.raw;
    if (!event.thought) return { ...current, raw };
    const thought = {
      thought: event.thought,
      reflection: "",
      timestamp: event.timestamp || new Date().toISOString(),
    };
    return {
      ...current,
      raw,
      thoughts: [...current.thoughts, thought],
      events: [...current.events, { type: "thought", ...thought }],
    };
  }

  if (event.type === "message_end") {
    const content = compactStreamText(event.content || "");
    if (!content) return current;
    const message = { role: "assistant", content, timestamp: event.timestamp || new Date().toISOString() };
    return {
      ...current,
      messages: [...current.messages, message],
    };
  }

  if (event.type === "tool_start") {
    const call = {
      id: String(event.tool?.id || ""),
      name: String(event.tool?.name || "tool"),
      args: event.tool?.args || {},
      timestamp: event.tool?.timestamp || event.timestamp || new Date().toISOString(),
    };
    return {
      ...current,
      toolCalls: upsertTraceItem(current.toolCalls, call, (item) => item.id || item.name),
      events: upsertTraceItem([...current.events], { type: "tool_call", call, timestamp: call.timestamp }, (item) =>
        item.type === "tool_call" ? item.call?.id || item.call?.name : `${item.type}:${item.timestamp || item.title || item.content}`
      ),
    };
  }

  if (event.type === "tool_update" || event.type === "tool_end") {
    const call = current.toolCalls.find((item) => item.id && item.id === event.toolId);
    const existing = current.toolResults.find((item) => item.id && item.id === event.toolId);
    const output = compactStreamText(event.output || "");
    const content =
      event.type === "tool_update"
        ? compactStreamText(`${existing?.content || ""}${output}`)
        : output || existing?.content || "";
    const result = {
      id: String(event.toolId || ""),
      name: String(event.toolName || call?.name || "tool"),
      content,
      timestamp: event.timestamp || new Date().toISOString(),
    };
    return {
      ...current,
      raw: output ? appendRawTraceText(current.raw, event.stream, output) : current.raw,
      toolResults: upsertTraceItem(current.toolResults, result, (item) => item.id || item.name),
    };
  }

  if (event.type === "permission_request") {
    return {
      ...current,
      events: [...current.events, event],
    };
  }

  if (event.type === "status") {
    const statusEvent = {
      type: "status",
      status: String(event.status || "status"),
      title: String(event.label || statusEventTitle(event.status)),
      timestamp: event.timestamp || new Date().toISOString(),
    };
    return {
      ...current,
      events: [...current.events, statusEvent],
    };
  }

  if (event.type === "error") {
    const errorEvent = {
      type: "error",
      title: String(event.error || "Agent stream failed"),
      timestamp: event.timestamp || new Date().toISOString(),
    };
    return {
      ...current,
      raw: event.error ? appendRawTraceText(current.raw, "stderr", event.error) : current.raw,
      events: [...current.events, errorEvent],
    };
  }

  return current;
}

function statusEventTitle(status) {
  if (status === "sdk_prepare") return "Preparing SDK transport...";
  if (status === "sdk_start") return "Starting the local agent bridge...";
  if (status === "prompt_start") return "Sending the request to the model...";
  if (status === "sdk_startup_failed") return "SDK bridge did not produce events; trying CLI transport...";
  if (status === "cli_fallback") return "SDK bridge was unavailable; using CLI transport...";
  if (status === "cli_start") return "Running local runtime...";
  if (status === "agent_start") return "Starting the agent...";
  if (status === "turn_start") return "Reading the request...";
  if (status === "message_start") return "Composing the answer...";
  return "Working...";
}

function streamActivityLabel(event) {
  if (!event || typeof event !== "object") return "";
  if (event.label) return String(event.label);
  if (event.type === "message_delta" || event.type === "message_end") return "";
  if (event.type === "tool_start") return `Using ${event.tool?.name || "a tool"}...`;
  if (event.type === "tool_update") return `Reading ${event.toolName || "tool"} output...`;
  if (event.type === "tool_end") return event.success === false ? `${event.toolName || "Tool"} failed` : `${event.toolName || "Tool"} finished`;
  if (event.type === "permission_request") return "Waiting for permission...";
  if (event.type === "status") {
    return statusEventTitle(event.status);
  }
  return "";
}

function latestStatusTimestamp(records = []) {
  let latest = "";
  for (const record of records) {
    for (const field of ["updatedAt", "finishedAt", "completedAt", "startedAt", "createdAt", "lastConversationAt"]) {
      const value = String(record?.[field] || "");
      if (value && value > latest) latest = value;
    }
  }
  return latest || new Date().toISOString();
}

function snapshotString(value, fallback = "") {
  return String(value || fallback || "").trim();
}

function incrementCount(map, key, amount = 1) {
  const normalizedKey = normalizeSquadMemberId(key);
  if (!normalizedKey) return;
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
}

function buildLiveStatusSnapshot({ agents = [], tasks = [], runs = [], automations = [], messagesByChannel = {}, currentRoute = "/mission-control" } = {}) {
  const agentNames = new Map(
    agents.map((agent) => [normalizeSquadMemberId(agent?.id), snapshotString(agent?.name, "Squad member")])
  );
  const onlineMembers = agents.filter((agent) => {
    const status = String(agent?.status || "online").toLowerCase();
    return !OFFLINE_MEMBER_STATUSES.has(status);
  }).length;
  const workingAgentIds = new Set();
  const queuedByAgent = new Map();
  const scheduledByAgent = new Map();
  const jobs = [];
  let activeWork = 0;
  let queuedJobs = 0;

  for (const task of tasks) {
    const status = String(task?.status || "").toLowerCase();
    const ownerId = normalizeSquadMemberId(task?.currentOwnerId || task?.agentId);
    if (WORKING_TASK_STATUSES.has(status)) {
      activeWork += 1;
      if (ownerId) workingAgentIds.add(ownerId);
    }
    if (QUEUED_TASK_STATUSES.has(status)) {
      queuedJobs += 1;
      incrementCount(queuedByAgent, ownerId);
    }
    if (WORKING_TASK_STATUSES.has(status) || QUEUED_TASK_STATUSES.has(status)) {
      jobs.push({
        id: snapshotString(task?.id, `task-${jobs.length + 1}`),
        title: snapshotString(task?.title || task?.summary, "Squad task"),
        status: status || "queued",
        agentId: ownerId || null,
        agentName: ownerId ? agentNames.get(ownerId) || null : null,
        source: snapshotString(task?.source, "task"),
        workspace: snapshotString(task?.project),
        updatedAt: snapshotString(task?.updatedAt || task?.createdAt),
      });
    }

    for (const assignment of Array.isArray(task?.assignments) ? task.assignments : []) {
      const assignmentStatus = String(assignment?.status || "").toLowerCase();
      if (!WORKING_TASK_STATUSES.has(assignmentStatus)) continue;
      const assignmentAgentId = normalizeSquadMemberId(assignment?.agentId);
      if (assignmentAgentId) workingAgentIds.add(assignmentAgentId);
    }
  }

  for (const run of runs) {
    const status = String(run?.status || "").toLowerCase();
    if (!LIVE_RUN_STATUSES.has(status)) continue;
    activeWork += 1;
    const runAgentId = normalizeSquadMemberId(run?.agentId || run?.agent_id);
    if (status === "queued") {
      queuedJobs += 1;
      incrementCount(queuedByAgent, runAgentId);
    }
    if (runAgentId) workingAgentIds.add(runAgentId);
    jobs.push({
      id: snapshotString(run?.id, `run-${jobs.length + 1}`),
      title: snapshotString(run?.title || run?.prompt, "Autohand run"),
      status,
      agentId: runAgentId || null,
      agentName: runAgentId ? agentNames.get(runAgentId) || null : null,
      source: "run",
      workspace: snapshotString(run?.workspace),
      updatedAt: snapshotString(run?.updatedAt || run?.startedAt || run?.createdAt),
    });
  }

  for (const messages of Object.values(messagesByChannel || {})) {
    if (!Array.isArray(messages)) continue;
    for (const message of messages) {
      if (
        message?.role !== "agent" ||
        message?.status !== "loading" ||
        !presenceRecordIsFresh(message, PRESENCE_LOADING_MESSAGE_MAX_AGE_MS)
      ) {
        continue;
      }
      const messageAgentId = normalizeSquadMemberId(message.agentId);
      if (!messageAgentId) continue;
      activeWork += 1;
      workingAgentIds.add(messageAgentId);
      jobs.push({
        id: snapshotString(message.id, `channel-${jobs.length + 1}`),
        title: snapshotString(message.activityLabel, "Channel reply"),
        status: "running",
        agentId: messageAgentId,
        agentName: agentNames.get(messageAgentId) || null,
        source: "channel",
        workspace: snapshotString(message.workspace),
        updatedAt: snapshotString(message.updatedAt || message.startedAt || message.createdAt),
      });
    }
  }

  const scheduledJobs = automations.filter(
    (automation) => automation?.status === "active" && automation?.triggerType === "schedule"
  ).length;
  for (const automation of automations) {
    const automationAgentId = normalizeSquadMemberId(automation?.agentId);
    if (automation?.status === "active" && automation?.triggerType === "schedule") {
      incrementCount(scheduledByAgent, automationAgentId);
      jobs.push({
        id: snapshotString(automation?.id, `automation-${jobs.length + 1}`),
        title: snapshotString(automation?.name, "Scheduled workflow"),
        status: "scheduled",
        agentId: automationAgentId || null,
        agentName: automationAgentId ? agentNames.get(automationAgentId) || null : null,
        source: "automation",
        workspace: snapshotString(automation?.workspace || automation?.target),
        scheduledFor: automationNextRunLabel(automation),
        updatedAt: snapshotString(automation?.updatedAt || automation?.createdAt),
      });
    }
  }

  const members = agents.map((agent) => {
    const id = normalizeSquadMemberId(agent?.id);
    return {
      id,
      name: snapshotString(agent?.name, "Squad member"),
      role: snapshotString(agent?.role) || null,
      status: String(agent?.status || "online").toLowerCase(),
      working: workingAgentIds.has(id),
      queuedJobs: queuedByAgent.get(id) || 0,
      scheduledJobs: scheduledByAgent.get(id) || 0,
      lastActivityAt: snapshotString(agent?.lastConversationAt || agent?.updatedAt || agent?.createdAt),
    };
  });
  const workflowDetails = automations.map((automation) => {
    const agentId = normalizeSquadMemberId(automation?.agentId);
    return {
      id: snapshotString(automation?.id, "automation"),
      name: snapshotString(automation?.name, "Workflow"),
      status: String(automation?.status || "active").toLowerCase(),
      agentId: agentId || null,
      agentName: agentId ? agentNames.get(agentId) || null : null,
      triggerType: snapshotString(automation?.triggerType, "schedule"),
      schedule: automationScheduleLabel(automation),
      workspace: snapshotString(automation?.workspace || automation?.target),
      updatedAt: snapshotString(automation?.updatedAt || automation?.createdAt),
    };
  });

  return {
    onlineMembers,
    workingAgents: Math.max(workingAgentIds.size, activeWork > 0 ? 1 : 0),
    queuedJobs,
    scheduledJobs,
    activeWork,
    queueDepth: queuedJobs,
    totalRuns: runs.length,
    members,
    jobs: jobs.slice(0, 40),
    automations: workflowDetails.slice(0, 40),
    currentRoute: routeWithoutModalParams(currentRoute),
    lastActivityAt: latestStatusTimestamp([
      ...agents,
      ...tasks,
      ...runs,
      ...automations,
      ...Object.values(messagesByChannel || {}).flat().filter(Boolean),
    ]),
  };
}

function channelMessagesForAgent(messagesByChannel = {}, agentId = "") {
  const normalizedAgentId = normalizeSquadMemberId(agentId);
  if (!normalizedAgentId || !messagesByChannel || typeof messagesByChannel !== "object") return [];
  const messages = [];
  for (const [channelId, channelMessages] of Object.entries(messagesByChannel)) {
    if (!Array.isArray(channelMessages)) continue;
    for (const message of channelMessages) {
      if (normalizeSquadMemberId(message?.agentId) === normalizedAgentId) {
        messages.push({ ...message, channelId: message.channelId || channelId });
      }
    }
  }
  return messages;
}

function memberPresenceForAgent(agent, { tasks = [], runs = [], messagesByAgent = {}, messagesByChannel = {} } = {}) {
  const agentId = normalizeSquadMemberId(agent?.id);
  const storedStatus = String(agent?.status || "online").toLowerCase();
  if (!agentId || OFFLINE_MEMBER_STATUSES.has(storedStatus)) {
    return {
      id: "offline",
      label: "Offline",
      description: "Offline",
      className: "bg-muted-foreground/45",
      textClassName: "text-muted-foreground",
      pulse: false,
    };
  }

  const agentRuns = runs.filter((run) => normalizeSquadMemberId(run?.agentId || run?.agent_id) === agentId);
  const liveRun = agentRuns.find((run) => LIVE_RUN_STATUSES.has(String(run?.status || "").toLowerCase()));
  const recentPendingTask = tasks.find((task) => {
    if (!taskBelongsToAgent(task, agentId) || !presenceRecordIsFresh(task, PRESENCE_PENDING_TASK_MAX_AGE_MS)) return false;
    const status = String(task?.status || "").toLowerCase();
    if (TERMINAL_TASK_STATUSES.has(status)) return false;
    if (!task?.runtimeId && ["launching", ...QUEUED_TASK_STATUSES].includes(status)) return true;
    return (Array.isArray(task?.assignments) ? task.assignments : []).some((assignment) => {
      const assignmentStatus = String(assignment?.status || "").toLowerCase();
      return (
        normalizeSquadMemberId(assignment?.agentId) === agentId &&
        !assignment?.runId &&
        QUEUED_TASK_STATUSES.has(assignmentStatus) &&
        presenceRecordIsFresh(assignment, PRESENCE_PENDING_TASK_MAX_AGE_MS)
      );
    });
  });
  const messages = [...(messagesByAgent?.[agentId] || []), ...channelMessagesForAgent(messagesByChannel, agentId)];
  const loadingMessage = [...messages].reverse().find(
    (message) =>
      message?.role === "agent" &&
      message?.status === "loading" &&
      presenceRecordIsFresh(message, PRESENCE_LOADING_MESSAGE_MAX_AGE_MS)
  );

  if (liveRun || loadingMessage) {
    const status = String(liveRun?.status || "").toLowerCase();
    const label = status === "queued" ? "Queued" : "Busy";
    const detail = liveRun?.title || liveRun?.prompt || loadingMessage?.activityLabel || "Work in progress";
    return {
      id: status === "queued" ? "queued" : "busy",
      label,
      description: `${label}: ${detail}`,
      className: status === "queued" ? "bg-amber-500" : "bg-destructive",
      textClassName: status === "queued" ? "text-amber-700 dark:text-amber-300" : "text-destructive",
      pulse: status !== "queued",
    };
  }

  if (recentPendingTask) {
    return {
      id: "queued",
      label: "Queued",
      description: `Queued: ${recentPendingTask.title || "Waiting for work"}`,
      className: "bg-amber-500",
      textClassName: "text-amber-700 dark:text-amber-300",
      pulse: false,
    };
  }

  return {
    id: "online",
    label: "Online",
    description: "Online",
    className: "bg-emerald-500",
    textClassName: "text-emerald-700 dark:text-emerald-300",
    pulse: false,
  };
}

function presenceRecordIsFresh(record, maxAgeMs) {
  const timestamp = record?.updatedAt || record?.startedAt || record?.createdAt || record?.time;
  const value = Date.parse(timestamp || "");
  if (!Number.isFinite(value)) return false;
  return Date.now() - value <= maxAgeMs;
}

function MemberPresenceBadge({ presence, className }) {
  return (
    <span
      className={cn(
        "inline-flex size-2.5 shrink-0 rounded-full ring-2 ring-background",
        presence.className,
        presence.pulse && "animate-pulse",
        className
      )}
      aria-hidden="true"
    />
  );
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
  const [memoryInbox, setMemoryInbox] = useState(() =>
    mergeSeedMemoryInbox(readStored(storageKeysFor("memoryInbox"), initialMemoryInbox))
  );
  const [memoryInboxBridgeReady, setMemoryInboxBridgeReady] = useState(false);
  const [channels, setChannels] = useState(() => mergeSeedChannels(readStored(storageKeysFor("channels"), initialChannels)));
  const [channelThreads, setChannelThreads] = useState(() =>
    mergeSeedChannelThreads(readStored(storageKeysFor("channelThreads"), {}))
  );
  const [messagesByChannel, setMessagesByChannel] = useState(() =>
    mergeSeedChannelMessages(readStored(storageKeysFor("channelMessages"), {}))
  );
  const [channelsBridgeReady, setChannelsBridgeReady] = useState(false);
  const [runs, setRuns] = useState([]);
  const [runtime, setRuntime] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [providerSettings, setProviderSettings] = useState(null);
  const [providerSettingsError, setProviderSettingsError] = useState("");
  const [runsError, setRunsError] = useState("");
  const [workspacesError, setWorkspacesError] = useState("");
  const [themePreference, setThemePreference] = useState(readThemePreference);
  const [handoffSettings, setHandoffSettings] = useState(readHandoffSettings);
  const [chatSettings, setChatSettings] = useState(readChatSettings);
  const [onboardingState, setOnboardingState] = useState(readOnboardingState);
  const [loginRequestStatus, setLoginRequestStatus] = useState("");
  const [systemTheme, setSystemTheme] = useState(getSystemColorMode);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(
    () => readLocalStorage(storageKeysFor("sidebarCollapsed")) !== "false"
  );
  const [localePreference, setLocalePreference] = useState(readLocalePreference);
  const [systemLanguages, setSystemLanguages] = useState(getNavigatorLanguages);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const localeResolution = useMemo(
    () => resolveLocalePreference(localePreference, systemLanguages),
    [localePreference, systemLanguages]
  );
  const localeCopy = useMemo(() => getLocaleCopy(localeResolution.locale), [localeResolution.locale]);
  const theme = resolveEffectiveThemeMode(themePreference, systemTheme);
  const activeThemePreset = getThemePreset(themePreference, theme);

  useEffect(() => {
    setChannels((current) => mergeSeedChannels(current));
    setChannelThreads((current) => mergeSeedChannelThreads(current));
    setMessagesByChannel((current) => mergeSeedChannelMessages(current));
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Opening Autohand Squad (the daemon opens the app at "/") should land on
  // first-run setup until the user completes or skips it. Public beta access is
  // account-gated, so a signed-out user always returns to setup.
  useEffect(() => {
    const path = route.split("?")[0];
    if (path === "/" || path === "") {
      const accountReady = onboardingAccountReady(runtime);
      const setupRequired = !accountReady || onboardingIsIncomplete(onboardingState);
      const baseTarget = setupRequired ? ONBOARDING_ROUTE : SQUAD_DIRECTORY_ROUTE;
      const target = baseTarget + (route.includes("?") ? `?${route.split("?")[1]}` : "");
      window.history.replaceState({}, "", target);
      setRoute(target);
    }
  }, [onboardingState, route, runtime]);

  useEffect(() => {
    if (!runtime) return;
    const path = route.split("?")[0];
    if (path === ONBOARDING_ROUTE || onboardingAccountReady(runtime)) return;
    window.history.replaceState({}, "", ONBOARDING_ROUTE);
    setRoute(ONBOARDING_ROUTE);
  }, [route, runtime]);

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
    try {
      window.localStorage.setItem(STORAGE_KEYS.chatSettings, JSON.stringify(normalizeChatSettings(chatSettings)));
    } catch {
      // Ignore storage failures in private browsing or locked-down webviews.
    }
  }, [chatSettings]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.onboarding, JSON.stringify(onboardingState));
    } catch {
      // Ignore storage failures in private browsing or locked-down webviews.
    }
  }, [onboardingState]);

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
    window.localStorage.setItem(STORAGE_KEYS.channels, JSON.stringify(channels));
  }, [channels]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.channelThreads, JSON.stringify(channelThreads));
  }, [channelThreads]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.channelMessages, JSON.stringify(messagesByChannel));
  }, [messagesByChannel]);

  // Mirror channel/thread state to the local bridge so the daemon can surface
  // the same channels.json in queue/run telemetry across reloads and restarts.
  useEffect(() => {
    if (!channelsBridgeReady) return;
    api("/api/channels", {
      method: "PUT",
      body: JSON.stringify({
        channels,
        threads: Object.values(channelThreads).flat(),
        messages: Object.values(messagesByChannel).flat(),
      }),
    }).catch(() => {
      // Browser storage remains the fallback if the local Squad bridge is unavailable.
    });
  }, [channels, channelThreads, messagesByChannel, channelsBridgeReady]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.memoryInbox, JSON.stringify(memoryInbox));
    if (!memoryInboxBridgeReady) return;
    api("/api/memory-inbox", {
      method: "PUT",
      body: JSON.stringify({ items: memoryInbox }),
    }).catch(() => {
      // Browser storage remains the fallback if the local Squad bridge is unavailable.
    });
  }, [memoryInbox, memoryInboxBridgeReady]);

  useEffect(() => {
    const controller = new AbortController();
    const postStatusSnapshot = () => {
      api("/api/status/snapshot", {
        method: "POST",
        body: JSON.stringify(buildLiveStatusSnapshot({ agents, tasks, runs, automations, messagesByChannel, currentRoute: route })),
        signal: controller.signal,
      }).catch(() => {
        // The tray can still fall back to daemon-owned queue and run records.
      });
    };
    const timer = window.setTimeout(postStatusSnapshot, 150);
    const interval = window.setInterval(postStatusSnapshot, 15_000);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [agents, automations, messagesByChannel, route, runs, tasks]);

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

  async function refreshRuntime() {
    try {
      const data = await api("/api/runtime");
      setRuntime(data);
      return data;
    } catch {
      const fallback = { available: false, autohandPath: "", version: "" };
      setRuntime(fallback);
      return fallback;
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadRuntime() {
      const data = await refreshRuntime();
      if (cancelled) return;
      setRuntime(data);
    }
    loadRuntime();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProviderSettings() {
      try {
        const data = await api("/api/provider-settings");
        if (!cancelled) {
          setProviderSettings(data);
          setProviderSettingsError("");
        }
      } catch (error) {
        if (!cancelled) {
          const message = error.message || "Provider settings could not be loaded.";
          const bridgeUnavailable =
            message.includes("/api/provider-settings failed: 404") ||
            message.includes("returned the app shell") ||
            message.includes("Request failed: 404");
          if (bridgeUnavailable) {
            setProviderSettings(
              defaultProviderSettings(
                "The local bridge has not loaded the provider settings API yet. Restart Autohand Squad to save or test provider settings; this page is showing the default registry."
              )
            );
            setProviderSettingsError(
              "Restart Autohand Squad to save or test provider settings. The defaults below are shown from the current app."
            );
          } else {
            setProviderSettings(null);
            setProviderSettingsError(message);
          }
        }
      }
    }
    loadProviderSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadMemoryInbox() {
      try {
        const data = await api("/api/memory-inbox");
        if (!cancelled && Array.isArray(data?.items)) {
          setMemoryInbox(mergeSeedMemoryInbox(data.items));
        }
      } catch {
        // Browser storage remains the startup fallback when opened without the local bridge.
      } finally {
        if (!cancelled) setMemoryInboxBridgeReady(true);
      }
    }
    loadMemoryInbox();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadChannels() {
      try {
        const data = await api("/api/channels");
        if (!cancelled && Array.isArray(data?.channels)) {
          setChannels((current) => {
            const byId = new Map(current.map((channel) => [channel.id, channel]));
            for (const record of data.channels.map(normalizeChannelCopy).filter(Boolean)) {
              const local = byId.get(record.id);
              // Latest write wins so bridge-side edits survive a reload without
              // clobbering newer local changes made while offline.
              if (!local || String(record.updatedAt) > String(local.updatedAt)) {
                byId.set(record.id, record);
              }
            }
            return mergeSeedChannels(Array.from(byId.values()));
          });
          if (Array.isArray(data.threads) && data.threads.length) {
            setChannelThreads((current) => {
              const next = { ...current };
              for (const record of data.threads.map(normalizeChannelThreadCopy).filter(Boolean)) {
                const existing = next[record.channelId] || [];
                const existingIndex = existing.findIndex((thread) => thread.id === record.id);
                if (existingIndex === -1) {
                  next[record.channelId] = [...existing, record];
                } else {
                  const local = existing[existingIndex];
                  const bridgeHasNewerActivity =
                    String(record.updatedAt || "") > String(local.updatedAt || "") ||
                    Number(record.replyCount || 0) > Number(local.replyCount || 0);
                  if (bridgeHasNewerActivity) {
                    next[record.channelId] = existing.map((thread, index) =>
                      index === existingIndex ? { ...thread, ...record } : thread
                    );
                  }
                }
              }
              return next;
            });
          }
          if (Array.isArray(data.messages) && data.messages.length) {
            setMessagesByChannel((current) => {
              const bridgeMessages = normalizeChannelMessagesCopy(data.messages);
              const next = { ...current };
              for (const [channelId, messages] of Object.entries(bridgeMessages)) {
                const existing = next[channelId] || [];
                const byId = new Map(existing.map((message) => [message.id, message]));
                for (const message of messages) {
                  const local = byId.get(message.id);
                  if (!local) {
                    byId.set(message.id, message);
                    continue;
                  }
                  const bridgeTimestamp = String(message.updatedAt || message.completedAt || message.startedAt || message.time || "");
                  const localTimestamp = String(local.updatedAt || local.completedAt || local.startedAt || local.time || "");
                  byId.set(message.id, bridgeTimestamp > localTimestamp ? { ...local, ...message } : { ...message, ...local });
                }
                next[channelId] = Array.from(byId.values());
              }
              return next;
            });
          }
        }
      } catch {
        // Browser storage remains the startup fallback when opened without the local bridge.
      } finally {
        if (!cancelled) setChannelsBridgeReady(true);
      }
    }
    loadChannels();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspaces() {
      try {
        const data = await api("/api/workspaces");
        if (!cancelled) {
          setWorkspaces(data);
          setWorkspacesError("");
        }
      } catch {
        if (!cancelled) {
          setWorkspaces([]);
          setWorkspacesError("Workspace list could not be loaded from the local bridge.");
        }
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
        if (!cancelled) {
          setRuns(data);
          setRunsError("");
        }
      } catch {
        if (!cancelled) {
          setRuns([]);
          setRunsError("Run output could not be loaded from the local bridge.");
        }
      }
    }
    loadRuns();
    const timer = window.setInterval(loadRuns, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const terminalRuns = new Map(
      runs
        .filter((run) => run?.id && ["completed", "failed", "stopped"].includes(run.status))
        .map((run) => [run.id, run])
    );
    if (!terminalRuns.size) return;

    setTasks((current) => {
      let changed = false;
      const next = current.map((task) => {
        const run = terminalRuns.get(task.runtimeId);
        if (!run) return task;

        const finalEventId = `${task.id}-run-${run.id}-final`;
        const existingTimeline = Array.isArray(task.timeline) ? task.timeline : [];
        if (existingTimeline.some((event) => event.id === finalEventId)) return task;

        changed = true;
        const finishedAt = run.finishedAt || new Date().toISOString();
        const finalStatus = run.status === "completed" ? "completed" : run.status === "stopped" ? "failed" : "failed";
        const lastLog = [...(Array.isArray(run.logs) ? run.logs : [])].reverse().find((log) => log?.line)?.line || run.command || "No run output recorded.";
        const unresolvedRisks =
          finalStatus === "completed"
            ? []
            : [`Run ${compactRecordId(run.id)} ended with ${run.status}${run.exitCode !== null && run.exitCode !== undefined ? ` (${run.exitCode})` : ""}.`];
        const timelineAdditions = [
          ...(unresolvedRisks.length
            ? [
                {
                  id: `${task.id}-run-${run.id}-risk`,
                  type: "risk.open",
                  evidenceType: "risk",
                  at: finishedAt,
                  actorAgentId: task.currentOwnerId || task.agentId || run.agentId,
                  targetAgentId: task.currentOwnerId || task.agentId || run.agentId,
                  runId: run.id,
                  logPath: run.logPath,
                  summary: unresolvedRisks[0],
                  unresolvedRisks,
                },
              ]
            : []),
          {
            id: finalEventId,
            type: "final.summary",
            evidenceType: "final",
            at: finishedAt,
            actorAgentId: task.currentOwnerId || task.agentId || run.agentId,
            targetAgentId: task.currentOwnerId || task.agentId || run.agentId,
            runId: run.id,
            logPath: run.logPath,
            summary: finalStatus === "completed" ? "Autohand run completed with bounded raw output retained." : "Autohand run ended before completion.",
            confirmedEvidence: [
              run.command ? `Command: ${run.command}` : "",
              lastLog ? `Last output: ${lastLog}` : "",
              run.logPath ? `Raw log: ${run.logPath}` : "",
            ].filter(Boolean),
            unresolvedRisks,
          },
        ];

        const finalTimeline = [...existingTimeline, ...timelineAdditions];
        // Goal 09: when the task ran from a recipe, score its done criteria
        // against the captured evidence timeline once the run is terminal.
        const recipeDoneCriteriaResults = task.recipeId
          ? evaluateRecipeDoneCriteria({ ...task, timeline: finalTimeline }, run)
          : task.recipeDoneCriteriaResults || null;

        return {
          ...task,
          status: finalStatus,
          summary: finalStatus === "completed" ? lastLog : `Run ended with ${run.status}: ${lastLog}`,
          updatedAt: finishedAt,
          recipeDoneCriteriaResults,
          assignments: (Array.isArray(task.assignments) ? task.assignments : []).map((assignment) =>
            assignment.runId === run.id ? { ...assignment, status: finalStatus, updatedAt: finishedAt } : assignment
          ),
          timeline: finalTimeline,
        };
      });
      return changed ? next : current;
    });
  }, [runs]);

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
  const sidebarCounts = useMemo(
    () => missionControlCounts({ agents, tasks, runtime, memoryInbox }),
    [agents, memoryInbox, runtime, tasks]
  );
  const activeSection = useMemo(() => memberSectionFromRoute(route), [route]);
  const requestedWorkspace = useMemo(() => {
    const params = new URLSearchParams(route.split("?")[1] || "");
    return normalizeSquadWorkspacePath(params.get("workspace") || "", runtime);
  }, [route, runtime]);
  const settingsSection = useMemo(() => {
    const params = new URLSearchParams(route.split("?")[1] || "");
    const section = params.get("section") || "";
    return ["appearance", "language", "providers", "chat", "handoff", "runtime"].includes(section) ? section : "";
  }, [route]);

  function navigate(path) {
    window.history.pushState({}, "", path);
    setRoute(path);
    setMobileSidebarOpen(false);
  }

  function openSettings() {
    navigate("/settings");
  }

  function openAnalytics() {
    navigate("/usage");
  }

  function openOnboarding() {
    navigate(ONBOARDING_ROUTE);
  }

  function updateOnboardingState(patch) {
    setOnboardingState((current) =>
      normalizeOnboardingState({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      })
    );
  }

  async function requestAccountLogin() {
    setLoginRequestStatus("Opening the existing Autohand Squad browser login...");
    try {
      const result = await api("/api/setup/login", { method: "POST" });
      setLoginRequestStatus(result.message || "Login opened. Complete it in the browser, then refresh status.");
    } catch (error) {
      setLoginRequestStatus(error.message || "Use the Autohand Squad tray menu and choose Login, then refresh status.");
    }
  }

  async function refreshAccountStatus() {
    await refreshRuntime();
    setLoginRequestStatus("Status refreshed.");
  }

  function finishOnboarding() {
    updateOnboardingState({ status: ONBOARDING_STATUS_COMPLETED, lastStep: "complete" });
    const target = routeWithParams(memberChatPath(activeAgent?.id), {
      workspace: onboardingState.selectedWorkspace || requestedWorkspace || fallbackWorkspace || null,
    });
    navigate(target);
  }

  function skipOnboarding() {
    if (!onboardingAccountReady(runtime)) {
      setLoginRequestStatus("Sign in before opening the Squad workspace. Public beta access requires an Autohand account.");
      navigate(ONBOARDING_ROUTE);
      return;
    }
    updateOnboardingState({ status: ONBOARDING_STATUS_SKIPPED, lastStep: "skipped" });
    navigate(squadDirectoryPath());
  }

  function openFeedback(kind = "feedback") {
    navigate(routeWithParams(routeWithoutModalParams(route), { feedback: kind === "bug" ? "bug" : "feedback" }));
  }

  function closeFeedback() {
    navigate(routeWithoutModalParams(route));
  }

  function closeAbout() {
    navigate(routeWithoutModalParams(route));
  }

  function updateAgent(agentId, patch) {
    setAgents((current) =>
      current.map((agent) => (agent.id === agentId ? { ...agent, ...patch } : agent))
    );
  }

  function deleteAgent(agentId) {
    const normalized = normalizeSquadMemberId(agentId);
    if (!normalized) return;
    setAgents((current) => current.filter((agent) => normalizeSquadMemberId(agent.id) !== normalized));
    setMessagesByAgent((current) => {
      const next = { ...current };
      delete next[agentId];
      delete next[normalized];
      return next;
    });
    setAutomations((current) => current.filter((automation) => !automationBelongsToAgent(automation, normalized)));
    if (isMemberRouteForAgent(route, normalized)) {
      navigate(squadDirectoryPath());
    }
  }

  function saveMemoryProposalEdit(itemId, patch) {
    const timestamp = new Date().toISOString();
    setMemoryInbox((current) =>
      current.map((item) => {
        if (item.id !== itemId) return item;
        const ownerAgent = agents.find((agent) => agent.id === item.ownerAgentId);
        const nextScope = normalizeMemoryScope(patch.scope ?? item.scope);
        const projectPatch =
          nextScope === "project" && !item.projectKey ? projectMemoryPatchForAgent(item, ownerAgent, runtime) : {};
        const nextContent = String(patch.content ?? item.content).trim();
        const contentChanged = nextContent && nextContent !== item.content;
        const editHistory = contentChanged
          ? [...(item.editHistory || []), { at: timestamp, before: item.content, after: nextContent }]
          : item.editHistory || [];
        return normalizeMemoryProposal({
          ...item,
          ...patch,
          ...projectPatch,
          scope: nextScope,
          content: nextContent || item.content,
          editHistory,
          updatedAt: timestamp,
        });
      })
    );
  }

  function acceptMemoryProposal(itemId) {
    const timestamp = new Date().toISOString();
    const target = memoryInbox.find((item) => item.id === itemId);
    const ownerAgent = agents.find((agent) => agent.id === target?.ownerAgentId);
    const projectPatch =
      normalizeMemoryScope(target?.scope) === "project" && !target?.projectKey
        ? projectMemoryPatchForAgent(target, ownerAgent, runtime)
        : {};
    const accepted = normalizeMemoryProposal({
      ...target,
      ...projectPatch,
      status: "accepted",
      acceptedAt: target?.acceptedAt || timestamp,
      updatedAt: timestamp,
      isHidden: false,
    });
    if (!accepted) return;

    setMemoryInbox((current) =>
      current.map((item) => (item.id === itemId ? accepted : item))
    );
    setAgents((current) =>
      current.map((agent) => {
        if (agent.id !== accepted.ownerAgentId) return agent;
        const memory = Array.from(new Set([...(Array.isArray(agent.memory) ? agent.memory : []), accepted.content]));
        const nextAgent = {
          ...agent,
          memory,
          updatedAt: timestamp,
        };
        return {
          ...nextAgent,
          profileFiles: refreshedProfileFilesForAgent(nextAgent),
        };
      })
    );
  }

  function rejectMemoryProposal(itemId, reason = "") {
    const timestamp = new Date().toISOString();
    setMemoryInbox((current) =>
      current.map((item) =>
        item.id === itemId
          ? normalizeMemoryProposal({
              ...item,
              status: "rejected",
              rejectedAt: item.rejectedAt || timestamp,
              rejectReason: String(reason || item.rejectReason || "").trim(),
              updatedAt: timestamp,
            })
          : item
      )
    );
  }

  function hideRejectedMemory(itemId) {
    setMemoryInbox((current) =>
      current.map((item) =>
        item.id === itemId ? normalizeMemoryProposal({ ...item, isHidden: true, updatedAt: new Date().toISOString() }) : item
      )
    );
  }

  function purgeHiddenRejectedMemory() {
    setMemoryInbox((current) => current.filter((item) => !(item.status === "rejected" && item.isHidden)));
  }

  function appendMemoryProposals(proposals) {
    const normalized = normalizeMemoryInboxCopy(proposals).filter(Boolean);
    if (!normalized.length) return;
    setMemoryInbox((current) => {
      const seen = new Set(current.map((item) => item.id));
      return [...normalized.filter((item) => !seen.has(item.id)), ...current];
    });
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
    const startedAt = now.toISOString();
    const requestStartedAt = performance.now();
    const time = now.toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" });
    const prompt = String(launch.prompt || "").trim();
    const selectedWorkspace = normalizeSquadWorkspacePath(launch.workspace || fallbackWorkspace, runtime);
    if (!prompt) return;

    const id = `chat-${Date.now().toString(36)}`;
    const collaborationContext = buildCollaborationProfileContext(launch.collaboration, agents, workspaces);
    const profile = [buildAgentProfile(agent, selectedWorkspace), collaborationContext].filter(Boolean).join("\n\n");
    touchAgent(agentId, startedAt);
    appendMessage(agentId, { id: `${id}-u`, role: "user", body: prompt, time });
    appendMessage(agentId, {
      id: `${id}-a`,
      role: "agent",
      body: `${agent.name} is thinking...`,
      status: "loading",
      time,
      startedAt,
    });

    const payload = {
      agentId,
      prompt,
      workspace: selectedWorkspace,
      policy: launch.policy,
      model: launch.model,
      profile,
      agent: agentLaunchPayload(agent, selectedWorkspace),
      collaboration: launch.collaboration || null,
    };
    let streamedAnswer = "";
    let liveTrace = createLiveChatTrace();
    let streamError = null;
    let completed = false;
    let finalResult = null;

    try {
      await streamApi(
        "/api/chat/stream",
        {
          method: "POST",
          signal: launch.signal,
          body: JSON.stringify(payload),
        },
        (event, data) => {
          if (event === "start") {
            updateMessage(agentId, `${id}-a`, {
              startedAt: data.startedAt || startedAt,
              workspace: data.workspace || selectedWorkspace,
              effectiveModel: data.effectiveModel,
            });
            return;
          }

          if (event === "sdk") {
            if (data.type === "message_delta" && data.delta) {
              streamedAnswer = `${streamedAnswer}${data.delta}`;
            } else if (data.type === "message_end" && data.content) {
              streamedAnswer = data.content;
            } else if (data.type === "error") {
              streamError = new Error(data.error || `${agent.name} could not answer.`);
            }

            liveTrace = updateLiveTraceFromStreamEvent(liveTrace, data);
            updateMessage(agentId, `${id}-a`, {
              body: streamedAnswer || `${agent.name} is thinking...`,
              trace: liveTrace,
              status: "loading",
              activityLabel: streamActivityLabel(data),
            });
            return;
          }

          if (event === "done") {
            completed = true;
            const replyTime = new Date().toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" });
            const completedAt = new Date().toISOString();
            const serverDurationMs = Number(data.durationMs);
            finalResult = {
              reply: data.reply || streamedAnswer || `${agent.name} returned no chat text.`,
              trace: data.trace || liveTrace,
              command: data.command || "",
              workspace: data.workspace || selectedWorkspace,
              startedAt: data.startedAt || startedAt,
              completedAt,
              durationMs: Number.isFinite(serverDurationMs) ? serverDurationMs : Math.round(performance.now() - requestStartedAt),
              transport: data.transport || "",
              effectiveModel: data.effectiveModel,
            };
            updateMessage(agentId, `${id}-a`, {
              body: finalResult.reply,
              trace: finalResult.trace,
              command: finalResult.command,
              workspace: finalResult.workspace,
              status: "complete",
              time: replyTime,
              startedAt: finalResult.startedAt,
              completedAt: finalResult.completedAt,
              durationMs: finalResult.durationMs,
              transport: finalResult.transport,
              effectiveModel: finalResult.effectiveModel,
              activityLabel: "",
            });
            return;
          }

          if (event === "error") {
            streamError = new Error(data.error || `${agent.name} could not answer.`);
            streamError.details = data;
            if (data.trace) liveTrace = data.trace;
          }
        }
      );

      if (streamError) throw streamError;
      if (!completed) {
        const completedAt = new Date().toISOString();
        finalResult = {
          reply: streamedAnswer || `${agent.name} returned no chat text.`,
          trace: liveTrace,
          workspace: selectedWorkspace,
          completedAt,
          durationMs: Math.round(performance.now() - requestStartedAt),
        };
        updateMessage(agentId, `${id}-a`, {
          body: finalResult.reply,
          trace: finalResult.trace,
          completedAt,
          durationMs: finalResult.durationMs,
          activityLabel: "",
          status: "complete",
        });
      }
      return finalResult;
    } catch (error) {
      const completedAt = new Date().toISOString();
      const wasStopped = launch.signal?.aborted || isAbortError(error);
      const details = error?.details || {};
      const serverDurationMs = Number(details.durationMs);
      const errorReply = wasStopped
        ? streamedAnswer || `${agent.name} stopped this reply.`
        : `${agent.name} could not answer: ${error.message}`;
      updateMessage(agentId, `${id}-a`, {
        body: errorReply,
        trace: details.trace || liveTrace,
        command: details.command || "",
        workspace: details.workspace || selectedWorkspace,
        completedAt,
        durationMs: Number.isFinite(serverDurationMs) ? serverDurationMs : Math.round(performance.now() - requestStartedAt),
        transport: details.transport || "",
        effectiveModel: details.effectiveModel,
        activityLabel: "",
        status: wasStopped ? "stopped" : "error",
      });
      return {
        reply: streamedAnswer,
        error: error.message,
        stopped: wasStopped,
        completedAt,
        durationMs: Math.round(performance.now() - requestStartedAt),
      };
    }
  }

  function appendChannelMessage(channelId, message) {
    setMessagesByChannel((current) => ({
      ...current,
      [channelId]: [...(current[channelId] || []), message],
    }));
  }

  function updateChannelMessage(channelId, messageId, patch) {
    setMessagesByChannel((current) => ({
      ...current,
      [channelId]: (current[channelId] || []).map((message) =>
        message.id === messageId ? { ...message, ...patch } : message
      ),
    }));
  }

  function createChannel(draft) {
    const timestamp = new Date().toISOString();
    const channel = normalizeChannelCopy({
      id: `channel_${Date.now().toString(36)}`,
      name: draft.name,
      visibility: draft.visibility,
      memberIds: draft.memberIds,
      creatorId: "user",
      autoModeDefault: draft.autoModeDefault === true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (!channel) return;
    setChannels((current) => [...current, channel]);
    navigate(channelsPath(channel.id));
  }

  function updateChannel(channelId, patch) {
    const timestamp = new Date().toISOString();
    setChannels((current) =>
      current.map((channel) =>
        channel.id === channelId
          ? normalizeChannelCopy({
              ...channel,
              ...patch,
              id: channel.id,
              creatorId: channel.creatorId,
              createdAt: channel.createdAt,
              updatedAt: timestamp,
            }) || channel
          : channel
      )
    );
  }

  function toggleChannelMember(channelId, memberId) {
    const channel = channels.find((item) => item.id === channelId);
    if (!channel) return;
    const memberIds = channel.memberIds.includes(memberId)
      ? channel.memberIds.filter((id) => id !== memberId)
      : [...channel.memberIds, memberId];
    updateChannel(channelId, { memberIds });
  }

  function deleteChannel(channelId) {
    setChannels((current) => current.filter((channel) => channel.id !== channelId));
    setChannelThreads((current) => {
      const next = { ...current };
      delete next[channelId];
      return next;
    });
    setMessagesByChannel((current) => {
      const next = { ...current };
      delete next[channelId];
      return next;
    });
    if (channelIdFromRoute(route) === channelId) {
      navigate(channelsPath());
    }
  }

  // Dispatch one channel prompt (or thread follow-up) to a single member.
  // Mirrors the member chat path so per-member chat semantics stay intact,
  // but records the reply in the channel thread and carries the channel
  // contract (channelId/threadId/visibility/members/auto-mode) to the bridge.
  async function dispatchChannelMemberReply(
    channel,
    agent,
    { prompt, threadId, parentMessageId, autoMode, selfJudge, targetMemberIds = [], targetLabel = "" }
  ) {
    const now = new Date();
    const startedAt = now.toISOString();
    const time = now.toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" });
    const selectedWorkspace = normalizeSquadWorkspacePath(agent.workspace || fallbackWorkspace, runtime);
    const messageId = `${threadId}-${agent.id}-${Date.now().toString(36)}`;
    appendChannelMessage(channel.id, {
      id: messageId,
      channelId: channel.id,
      channelName: channel.name,
      role: "agent",
      agentId: agent.id,
      targetMemberIds,
      targetLabel,
      body: `${agent.name} is typing...`,
      status: "loading",
      time,
      threadId,
      parentMessageId,
      workspace: selectedWorkspace,
      startedAt,
      updatedAt: startedAt,
      activityLabel: `Replying in #${channel.name}`,
    });

    const profile = [
      buildAgentProfile(agent, selectedWorkspace),
      buildChannelProfileContext(channel, agent, agents, { autoMode, selfJudge, threadId, targetMemberIds, targetLabel }),
    ]
      .filter(Boolean)
      .join("\n\n");
    const payload = {
      agentId: agent.id,
      prompt,
      workspace: selectedWorkspace,
      policy: agent.launch?.policy,
      model: agent.launch?.model,
      transport: "cli",
      timeoutMs: 300000,
      profile,
      agent: agentLaunchPayload(agent, selectedWorkspace),
      channelId: channel.id,
      threadId,
      parentMessageId,
      visibility: channel.visibility,
      memberIds: targetMemberIds.length ? targetMemberIds : channel.memberIds,
      autoModeDefault: autoMode === true,
      selfJudge: selfJudge === true,
      channel: {
        id: channel.id,
        name: channel.name,
        visibility: channel.visibility,
        memberIds: targetMemberIds.length ? targetMemberIds : channel.memberIds,
        channelMemberIds: channel.memberIds,
        targetLabel,
        threadId,
        parentMessageId,
        autoModeDefault: autoMode === true,
        selfJudge: selfJudge === true,
      },
      collaboration: {
        role: "member",
        channelId: channel.id,
        threadId,
        runtime: { autoMode: autoMode === true, selfJudge: selfJudge === true },
      },
    };

    let streamedAnswer = "";
    let streamError = null;
    let completed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 305000);
    try {
      await streamApi(
        "/api/chat/stream",
        { method: "POST", signal: controller.signal, body: JSON.stringify(payload) },
        (event, data) => {
          if (event === "start") {
            updateChannelMessage(channel.id, messageId, {
              startedAt: data.startedAt || startedAt,
              workspace: data.workspace || selectedWorkspace,
              effectiveModel: data.effectiveModel,
              channel: data.channel,
              activityLabel: "Running local runtime...",
              updatedAt: new Date().toISOString(),
            });
            return;
          }
          if (event === "sdk") {
            if (data.type === "message_delta" && data.delta) {
              streamedAnswer = `${streamedAnswer}${data.delta}`;
            } else if (data.type === "message_end" && data.content) {
              streamedAnswer = data.content;
            } else if (data.type === "error") {
              streamError = new Error(data.error || `${agent.name} could not answer.`);
            }
            updateChannelMessage(channel.id, messageId, {
              body: channelStreamingReplyText(agent.name, streamedAnswer),
              status: "loading",
              activityLabel: streamActivityLabel(data) || `Replying in #${channel.name}`,
              updatedAt: new Date().toISOString(),
            });
            return;
          }
          if (event === "done") {
            completed = true;
            const completedAt = new Date().toISOString();
            const replyText = humanReadableReplyText(data.reply || streamedAnswer, data.trace, `${agent.name} returned no chat text.`);
            updateChannelMessage(channel.id, messageId, {
              body: replyText || `${agent.name} returned no chat text.`,
              status: "complete",
              time: new Date().toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" }),
              trace: data.trace,
              command: data.command || "",
              workspace: data.workspace || selectedWorkspace,
              transport: data.transport || "",
              effectiveModel: data.effectiveModel,
              completedAt,
              durationMs: data.durationMs,
              activityLabel: "",
              updatedAt: completedAt,
            });
            return;
          }
          if (event === "error") {
            streamError = new Error(data.error || `${agent.name} could not answer.`);
            streamError.details = data;
            const completedAt = data.completedAt || new Date().toISOString();
            updateChannelMessage(channel.id, messageId, {
              body: `${agent.name} could not answer: ${streamError.message}`,
              status: "error",
              trace: data.trace,
              command: data.command || "",
              workspace: data.workspace || selectedWorkspace,
              transport: data.transport || "",
              effectiveModel: data.effectiveModel,
              completedAt,
              durationMs: data.durationMs,
              activityLabel: "",
              updatedAt: completedAt,
            });
          }
        }
      );
      if (streamError) throw streamError;
      if (!completed) {
        const completedAt = new Date().toISOString();
        const replyText = humanReadableReplyText(streamedAnswer, null, `${agent.name} returned no chat text.`);
        updateChannelMessage(channel.id, messageId, {
          body: replyText || `${agent.name} returned no chat text.`,
          status: "complete",
          time: new Date().toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" }),
          completedAt,
          activityLabel: "",
          updatedAt: completedAt,
        });
      }
    } catch (error) {
      const completedAt = new Date().toISOString();
      const details = error?.details || {};
      const message = isAbortError(error)
        ? `${agent.name} could not answer: channel reply timed out waiting for its Autohand CLI.`
        : `${agent.name} could not answer: ${error.message}`;
      updateChannelMessage(channel.id, messageId, {
        body: message,
        status: "error",
        trace: details.trace,
        command: details.command || "",
        workspace: details.workspace || selectedWorkspace,
        transport: details.transport || "",
        effectiveModel: details.effectiveModel,
        completedAt,
        durationMs: details.durationMs,
        activityLabel: "",
        updatedAt: completedAt,
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  // One-prompt channel dispatch: a single user prompt opens a thread and fans
  // out to every squad member assigned to the channel; each member chooses its
  // own execution plan and posts an in-thread reply.
  async function sendChannelPrompt(channelId, { prompt, autoMode, selfJudge } = {}) {
    const channel = channels.find((item) => item.id === channelId);
    const text = String(prompt || "").trim();
    if (!channel || !text) return;
    const target = resolveChannelMentionTargets(text, channel, agents);
    const members = target.targetAgents;
    if (!members.length) return;
    const now = new Date();
    const timestamp = now.toISOString();
    const time = now.toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" });
    const threadId = `thread_${Date.now().toString(36)}`;
    const rootMessageId = `${threadId}-root`;
    const effectiveAutoMode = autoMode === undefined ? channel.autoModeDefault === true : autoMode === true;
    const effectiveSelfJudge = selfJudge === undefined ? effectiveAutoMode : selfJudge === true;

    setChannelThreads((current) => ({
      ...current,
      [channel.id]: [
        ...(current[channel.id] || []),
        {
          id: threadId,
          channelId: channel.id,
          parentMessageId: rootMessageId,
          title: text.slice(0, 200),
          creatorId: "user",
          memberIds: target.targetMemberIds,
          targetLabel: target.targetLabel,
          autoMode: effectiveAutoMode,
          selfJudge: effectiveSelfJudge,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }));
    appendChannelMessage(channel.id, {
      id: rootMessageId,
      role: "user",
      body: text,
      time,
      threadId,
      parentMessageId: "",
      targetMemberIds: target.targetMemberIds,
      targetLabel: target.targetLabel,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await Promise.allSettled(
      members.map((agent) =>
        dispatchChannelMemberReply(channel, agent, {
          prompt: text,
          threadId,
          parentMessageId: rootMessageId,
          autoMode: effectiveAutoMode,
          selfJudge: effectiveSelfJudge,
          targetMemberIds: target.targetMemberIds,
          targetLabel: target.targetLabel,
        })
      )
    );
  }

  // Threaded follow-ups: replies stay grouped under the original thread and
  // reuse the thread's recorded auto-mode/self-judge defaults.
  async function sendThreadFollowUp(channelId, threadId, prompt) {
    const channel = channels.find((item) => item.id === channelId);
    const thread = (channelThreads[channelId] || []).find((item) => item.id === threadId);
    const text = String(prompt || "").trim();
    if (!channel || !thread || !text) return;
    const now = new Date();
    const timestamp = now.toISOString();
    const time = now.toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" });
    const followUpId = `${threadId}-fu-${Date.now().toString(36)}`;
    const target = resolveChannelMentionTargets(text, channel, agents, { fallbackMemberIds: thread.memberIds });
    const members = target.targetAgents;
    if (!members.length) return;
    appendChannelMessage(channelId, {
      id: followUpId,
      role: "user",
      body: text,
      time,
      threadId,
      parentMessageId: thread.parentMessageId || `${threadId}-root`,
      targetMemberIds: target.targetMemberIds,
      targetLabel: target.targetLabel,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    setChannelThreads((current) => ({
      ...current,
      [channelId]: (current[channelId] || []).map((item) =>
        item.id === threadId
          ? {
              ...item,
              memberIds: Array.from(new Set([...(item.memberIds || []), ...target.targetMemberIds])),
              targetLabel: target.targetLabel || item.targetLabel,
              updatedAt: timestamp,
            }
          : item
      ),
    }));

    await Promise.allSettled(
      members.map((agent) =>
        dispatchChannelMemberReply(channel, agent, {
          prompt: text,
          threadId,
          parentMessageId: followUpId,
          autoMode: thread.autoMode === true,
          selfJudge: thread.selfJudge === true,
          targetMemberIds: target.targetMemberIds,
          targetLabel: target.targetLabel,
        })
      )
    );
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
      brainCard: normalizeBrainCard(draft.brainCard, draft),
      skillSource: draft.skillSource || AUTOHAND_SKILLS_REGISTRY_URL,
      launch: { mode: "prompt", policy: "restricted", model: "", dryRun: false },
      permissions: createDefaultPermissionState(),
      modelAssignment: { mode: "inherit" },
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
          agent: agentLaunchPayload(agent, agent.workspace),
        }),
      });
      const provisionedAt = new Date().toISOString();
      updateAgent(id, {
        skillInstall: { ...provision.skillInstall, status: provision.skillInstall?.failed?.length ? "partial" : "installed" },
        profileDocs: provision.profileDocs,
        updatedAt: provisionedAt,
      });
      appendMemoryProposals([
        ...(provision.skillInstall?.installed || []).map((skill) => ({
          id: `mem_${id}_${normalizeSkillId(skill.id)}_installed`,
          agentId: id,
          ownerAgentId: id,
          status: "pending",
          scope: "personal",
          content: `Autohand skill ${skill.id} is installed for ${agent.name}'s profile.`,
          confidence: 0.9,
          confidenceRationale: "Local provisioning completed and returned this skill in the installed list.",
          source: { type: "system", id: `provision-${id}`, label: "Skill provisioning", agentId: id },
          evidence: `Skill source: ${AUTOHAND_SKILLS_REGISTRY_URL}. Install target: .autohand/agents/${id}/skills.`,
          createdAt: provisionedAt,
          updatedAt: provisionedAt,
        })),
        ...(provision.skillInstall?.failed || []).map((skill) => ({
          id: `mem_${id}_${normalizeSkillId(skill.id)}_failed`,
          agentId: id,
          ownerAgentId: id,
          status: "pending",
          scope: "personal",
          content: `Autohand skill ${skill.id} failed to install for ${agent.name}${skill.reason ? `: ${skill.reason}` : "."}`,
          confidence: 0.78,
          confidenceRationale: "Local provisioning returned the skill in the failed list; user should decide whether this belongs in durable memory.",
          source: { type: "system", id: `provision-${id}`, label: "Skill provisioning", agentId: id },
          evidence: skill.reason || `Skill source: ${AUTOHAND_SKILLS_REGISTRY_URL}.`,
          createdAt: provisionedAt,
          updatedAt: provisionedAt,
        })),
      ]);
    } catch (error) {
      const failedAt = new Date().toISOString();
      updateAgent(id, {
        skillInstall: {
          source: AUTOHAND_SKILLS_REGISTRY_URL,
          requested: skills,
          installed: [],
          failed: [{ id: "provision", reason: error.message }],
          status: "failed",
        },
        updatedAt: failedAt,
      });
      appendMemoryProposals([
        {
          id: `mem_${id}_provision_failed`,
          agentId: id,
          ownerAgentId: id,
          status: "pending",
          scope: "personal",
          content: `Autohand profile provisioning failed for ${agent.name}: ${error.message}`,
          confidence: 0.8,
          confidenceRationale: "The local provisioning request failed; keep this out of active memory until reviewed.",
          source: { type: "system", id: `provision-${id}`, label: "Skill provisioning", agentId: id },
          evidence: error.message,
          createdAt: failedAt,
          updatedAt: failedAt,
        },
      ]);
    }
  }

  async function startAutohand(agentId, launch) {
    const agent = agents.find((item) => item.id === agentId) || activeAgent;
    const now = new Date();
    const time = now.toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" });
    const prompt = String(launch.prompt || "").trim();
    const selectedWorkspace = normalizeSquadWorkspacePath(launch.workspace || fallbackWorkspace, runtime);
    const taskId = `task-${Date.now().toString().slice(-5)}`;
    // Goal 09: a recipe overrides mode/policy/model and tags the task so the run
    // can be scored against the recipe's expected evidence and done criteria.
    const recipe = findRecipeById(launch.recipeId);
    const recipeOverrides = recipeLaunchOverrides(recipe);
    const effectiveMode = recipeOverrides?.mode || launch.mode;
    const effectivePolicy = recipeOverrides?.policy || launch.policy;
    const effectiveLaunchModel = recipeOverrides?.model || launch.model;

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
        source: recipe ? "recipe" : effectiveMode === "auto" ? "automation" : "conversation",
        recipeId: recipe?.id || null,
        recipeDoneCriteriaResults: null,
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
            id: `${taskId}-context-pack`,
            type: "context.pack.generated",
            evidenceType: "context-pack",
            at: now.toISOString(),
            actorAgentId: agentId,
            targetAgentId: agentId,
            workspace: selectedWorkspace,
            summary: `Context pack assembled for ${workspaceLabel(selectedWorkspace, workspaces)} before launch.`,
          },
          {
            id: `${taskId}-prompt`,
            type: "prompt.submitted",
            evidenceType: "prompt",
            at: now.toISOString(),
            actorAgentId: agentId,
            targetAgentId: agentId,
            summary: prompt || "Autohand prompt submitted.",
          },
          {
            id: `${taskId}-plan`,
            type: "plan.created",
            evidenceType: "plan",
            at: now.toISOString(),
            actorAgentId: agentId,
            targetAgentId: agentId,
            summary: recipe
              ? `Run recipe "${recipe.name}" with ${agent.name || "squad member"} at the ${autonomyLadderLevelMeta(recipe.permissionLevel).label} permission level against ${workspaceLabel(selectedWorkspace, workspaces)}.`
              : `Run ${agent.name || "squad member"} in ${launch.modeLabel || effectiveMode || "prompt"} mode against ${workspaceLabel(selectedWorkspace, workspaces)}.`,
            recipeId: recipe?.id || undefined,
            expectedEvidence: recipe ? recipe.expectedEvidence : undefined,
          },
          {
            id: `${taskId}-command-queued`,
            type: "command.queued",
            evidenceType: "command",
            at: now.toISOString(),
            actorAgentId: agentId,
            targetAgentId: agentId,
            summary: "Initial child run requested from the local bridge.",
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
          mode: effectiveMode,
          policy: effectivePolicy,
          model: effectiveLaunchModel,
          dryRun: launch.dryRun,
          recipeId: recipe?.id || undefined,
          profile: buildAgentProfile(agent, selectedWorkspace),
          agent: agentLaunchPayload(agent, selectedWorkspace),
        }),
      });
      setRuns((current) => [recipe ? { ...run, recipeId: recipe.id } : run, ...current]);
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
                  ...(task.timeline || []).map((event) =>
                    event.evidenceType === "context-pack" && run.contextPack
                      ? {
                          ...event,
                          runId: run.id,
                          contextPack: run.contextPack,
                          summary: run.contextPack.summary || event.summary,
                        }
                      : event
                  ),
                  {
                    id: `${task.id}-run-${run.id}`,
                    type: "command.started",
                    evidenceType: "command",
                    at: new Date().toISOString(),
                    actorAgentId: agentId,
                    targetAgentId: agentId,
                    runId: run.id,
                    command: run.command,
                    logPath: run.logPath,
                    summary: `Child run started with ${run.displayConfigPath || run.configPath || "isolated config"}${run.effectiveModel ? ` using ${providerSummaryLabel(run.effectiveModel)}` : ""}.`,
                  },
                ],
              }
            : task
        )
      );
      appendMessage(agentId, {
        id: `${taskId}-a`,
        role: "agent",
        body: `${agent.name} started ${recipe ? `recipe "${recipe.name}"` : `Autohand in ${launch.modeLabel || effectiveMode}`}. Runtime id: ${run.id.slice(0, 8)}. Config: ${run.displayConfigPath || run.configPath || "isolated"}.${run.effectiveModel ? ` Model: ${providerSummaryLabel(run.effectiveModel)}.` : ""}`,
        time,
        effectiveModel: run.effectiveModel,
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
          task.id === taskId
            ? {
                ...task,
                status: "failed",
                summary: error.message,
                updatedAt: new Date().toISOString(),
                timeline: [
                  ...(task.timeline || []),
                  {
                    id: `${task.id}-start-risk`,
                    type: "risk.open",
                    evidenceType: "risk",
                    at: new Date().toISOString(),
                    actorAgentId: agentId,
                    targetAgentId: agentId,
                    summary: error.message,
                    unresolvedRisks: [error.message],
                  },
                  {
                    id: `${task.id}-start-final`,
                    type: "final.summary",
                    evidenceType: "final",
                    at: new Date().toISOString(),
                    actorAgentId: agentId,
                    targetAgentId: agentId,
                    summary: "Autohand did not start.",
                    confirmedEvidence: ["Prompt, plan, and local bridge request were recorded."],
                    unresolvedRisks: [error.message],
                  },
                ],
              }
            : task
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

  // Goal 09: launch a recipe via the shared launch flow. The recipe id flows
  // into startAutohand, which derives the mode/policy/model overrides and tags
  // the task so its evidence and done criteria can be scored after the run.
  function startRecipe({ recipe, recipeId, agentId, prompt }) {
    const resolved = recipe || findRecipeById(recipeId);
    if (!resolved) return;
    const targetAgentId = normalizeSquadMemberId(agentId || activeAgent?.id);
    const targetAgent = agents.find((agent) => agent.id === targetAgentId) || activeAgent;
    if (!targetAgent) return;
    const requestText = String(prompt || "").trim() || `Run recipe "${resolved.name}": ${resolved.description}`;
    return startAutohand(targetAgentId, {
      recipeId: resolved.id,
      prompt: requestText,
      workspace: getAgentWorkspace(targetAgent, runtime, workspaces),
      mode: "goal",
      dryRun: false,
    });
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
    const autoAccept = source?.autoAccept === true || source?.type === "chat-mention";

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
      status: autoAccept ? "accepted" : "pending",
      channel: source?.type === "chat-mention" ? "chat-mention" : sourceRun ? "run" : "manual",
      reason: String(draft.reason || "").trim(),
      requiredContext: String(draft.requiredContext || "").trim(),
      expectedOutput: String(draft.expectedOutput || "").trim(),
      sourceEvidence: String(draft.sourceEvidence || "").trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
      acceptedAt: autoAccept ? timestamp : "",
      checkpointId: `checkpoint-${handoffId}`,
      attempt: 1,
    };
    const assignment = {
      id: `assignment-${handoffId}`,
      agentId: targetAgentId,
      sourceAgentId,
      status: autoAccept ? "running" : "pending",
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
      status: autoAccept ? "running" : "handoff-pending",
      updatedAt: timestamp,
      summary: autoAccept
        ? `${targetAgent.name} accepted handoff from ${sourceAgent?.name || "source"}: ${handoff.reason || "continue the parent task"}`
        : `Handoff to ${targetAgent.name}: ${handoff.reason || "continue the parent task"}`,
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
                evidenceType: "handoff",
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
          evidenceType: "handoff",
          at: timestamp,
          actorAgentId: sourceAgentId,
          targetAgentId,
          handoffId,
          summary: `${sourceAgent?.name || "Squad member"} handed this to ${targetAgent.name}.`,
          content: handoffContextText(handoff, baseTask, sourceAgent, targetAgent),
        },
        ...(autoAccept
          ? [
              {
                id: `timeline-${Date.now().toString(36)}-accepted`,
                type: "handoff.accepted",
                evidenceType: "handoff",
                at: timestamp,
                actorAgentId: targetAgentId,
                targetAgentId,
                handoffId,
                summary: `${targetAgent.name} accepted the live handoff from ${sourceAgent?.name || "source"}.`,
              },
            ]
          : []),
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
      body: autoAccept
        ? `Got it. I picked this up from ${sourceAgent?.name || "the source member"}.\n\n${handoffContextText(handoff, nextTask, sourceAgent, targetAgent)}`
        : handoffContextText(handoff, nextTask, sourceAgent, targetAgent),
      time,
      status: "handoff",
    });
    appendMessage(sourceAgentId, {
      id: `${handoffId}-sent`,
      role: "agent",
      body: autoAccept
        ? `Got it. I’m talking to ${targetAgent.name} now and keeping this in parent task ${compactRecordId(nextTask.id)}.`
        : `Handoff queued for ${targetAgent.name}. Parent task stays as ${compactRecordId(nextTask.id)}; ${targetAgent.name} is now the current owner.`,
      time,
      status: "handoff",
    });
    touchAgent(targetAgentId, timestamp);
    touchAgent(sourceAgentId, timestamp);
    setTaskPanelOpen(true);
    return {
      task: nextTask,
      handoff,
      sourceAgent,
      targetAgent,
      sourceAgentId,
      targetAgentId,
      workspace: source?.workspace || sourceRun?.workspace || fallbackWorkspace,
      handoffContext: handoffContextText(handoff, nextTask, sourceAgent, targetAgent),
    };
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
                  evidenceType: "handoff",
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
                  evidenceType: "risk",
                  at: timestamp,
                  actorAgentId: handoff.toAgentId,
                  targetAgentId: handoff.toAgentId,
                  handoffId: handoff.id,
                  summary: `Handoff checkpoint failed: ${failureReason}`,
                  unresolvedRisks: [failureReason],
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
                  evidenceType: "handoff",
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

  function recordCollaborationResult(handoffResult, result) {
    if (!handoffResult?.handoff?.id) return;
    const timestamp = new Date().toISOString();
    const sourceAgentId = normalizeSquadMemberId(handoffResult.sourceAgentId || handoffResult.handoff.fromAgentId);
    const targetAgentId = normalizeSquadMemberId(handoffResult.targetAgentId || handoffResult.handoff.toAgentId);
    const sourceAgent = agents.find((agent) => agent.id === sourceAgentId) || handoffResult.sourceAgent;
    const targetAgent = agents.find((agent) => agent.id === targetAgentId) || handoffResult.targetAgent;
    const hasError = Boolean(result?.error) && !result?.reply;
    const reply = String(result?.reply || "").trim();
    const summary = hasError
      ? `${targetAgent?.name || "Receiving member"} could not complete the handoff: ${result.error}`
      : `${targetAgent?.name || "Receiving member"} replied to the handoff.`;

    setTasks((current) =>
      current.map((task) => {
        if (task.id !== handoffResult.task?.id) return task;
        const isChatMention = handoffResult.handoff.channel === "chat-mention";
        return {
          ...task,
          status: hasError ? "blocked" : isChatMention ? "completed" : task.status,
          summary: hasError ? summary : reply.slice(0, 240) || summary,
          updatedAt: timestamp,
          handoffs: (Array.isArray(task.handoffs) ? task.handoffs : []).map((handoff) =>
            handoff.id === handoffResult.handoff.id
              ? {
                  ...handoff,
                  status: hasError ? "failed" : "completed",
                  failureReason: hasError ? result.error : "",
                  completedAt: hasError ? "" : timestamp,
                  updatedAt: timestamp,
                }
              : handoff
          ),
          assignments: (Array.isArray(task.assignments) ? task.assignments : []).map((assignment) =>
            assignment.handoffId === handoffResult.handoff.id
              ? {
                  ...assignment,
                  status: hasError ? "failed" : "completed",
                  failureReason: hasError ? result.error : "",
                  result: reply,
                  updatedAt: timestamp,
                }
              : assignment
          ),
          timeline: [
            ...(Array.isArray(task.timeline) ? task.timeline : []),
            {
              id: `timeline-${Date.now().toString(36)}-collab-result`,
              type: hasError ? "handoff.failed" : "handoff.result",
              evidenceType: hasError ? "risk" : "handoff",
              at: timestamp,
              actorAgentId: targetAgentId,
              targetAgentId: sourceAgentId,
              handoffId: handoffResult.handoff.id,
              summary,
              content: reply,
              unresolvedRisks: hasError ? [result.error] : [],
            },
          ],
        };
      })
    );

    appendMessage(sourceAgentId, {
      id: `${handoffResult.handoff.id}-result`,
      role: "agent",
      body: hasError
        ? `${targetAgent?.name || "The receiving member"} could not finish the handoff: ${result.error}`
        : `${targetAgent?.name || "The receiving member"} came back with:\n\n${reply || "No response text was returned."}`,
      time: new Date(timestamp).toLocaleTimeString(localeResolution.locale, { hour: "2-digit", minute: "2-digit" }),
      status: hasError ? "error" : "handoff",
    });
    touchAgent(sourceAgent?.id || sourceAgentId, timestamp);
    touchAgent(targetAgent?.id || targetAgentId, timestamp);
  }

  async function openTerminal(agent, prompt = "") {
    const workspace = normalizeSquadWorkspacePath(agent.workspace || fallbackWorkspace, runtime);
    await api("/api/terminal", {
      method: "POST",
      body: JSON.stringify({
        workspace,
        prompt,
        profile: buildAgentProfile(agent, workspace),
        agent: agentLaunchPayload(agent, workspace),
      }),
    });
  }

  async function runAutomation(automation) {
    const automationAgentId = normalizeSquadMemberId(automation.agentId) || activeAgent?.id;
    if (!automationAgentId) return;
    const automationAgent = agents.find((agent) => agent.id === automationAgentId) || activeAgent;
    const workspace = automation.workspace || workspacePath(automation.target, workspaces, automationAgent?.workspace || fallbackWorkspace);
    await startAutohand(automationAgentId, {
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

  const routePath = route.split("?")[0];
  const isProfile = isMemberProfileRoute(route);
  const isCreate = isCreateMemberRoute(route);
  const isExtensions = routePath.startsWith("/extensions");
  const isMissionControl = routePath === MISSION_CONTROL_ROUTE;
  const isSquadDirectory = routePath === SQUAD_DIRECTORY_ROUTE;
  const isChannels = routePath === CHANNELS_ROUTE || routePath.startsWith(`${CHANNELS_ROUTE}/`);
  const isOnboarding = routePath === ONBOARDING_ROUTE;
  const isAnalytics = routePath === "/usage" || routePath.startsWith("/settings/analytics");
  const isSettings = routePath === "/settings" || routePath.startsWith("/settings/");
  const feedbackKind = feedbackKindFromRoute(route);
  const aboutOpen = aboutOpenFromRoute(route);

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
            tasks={tasks}
            messagesByAgent={messagesByAgent}
            messagesByChannel={messagesByChannel}
            channels={channels}
            channelThreads={channelThreads}
            channelCount={channels.length}
            sidebarCounts={sidebarCounts}
            theme={theme}
            locale={localeResolution.locale}
            copy={localeCopy}
            onSettings={() => openSettings()}
            onMissionControl={() => navigate(missionControlPath())}
            onOnboarding={openOnboarding}
            onAnalytics={openAnalytics}
            onCreateChannel={createChannel}
            onCollapsedChange={setDesktopSidebarCollapsed}
          />
          <main className="min-w-0">
            <MobileTopbar
              activeAgent={activeAgent}
              theme={theme}
              copy={localeCopy}
              onMenu={() => setMobileSidebarOpen(true)}
              onSettings={() => openSettings()}
              onMissionControl={() => navigate(missionControlPath())}
              onOnboarding={openOnboarding}
              onAnalytics={openAnalytics}
            />
            {isOnboarding ? (
              <OnboardingPage
                runtime={runtime}
                providerSettings={providerSettings}
                providerSettingsError={providerSettingsError}
                workspaces={workspaces}
                agents={agents}
                activeAgent={activeAgent}
                fallbackWorkspace={fallbackWorkspace}
                requestedWorkspace={requestedWorkspace}
                onboardingState={onboardingState}
                loginRequestStatus={loginRequestStatus}
                navigate={navigate}
                updateOnboardingState={updateOnboardingState}
                onRequestLogin={requestAccountLogin}
                onRefreshAccount={refreshAccountStatus}
                onFinish={finishOnboarding}
                onSkip={skipOnboarding}
              />
            ) : isAnalytics ? (
              <SettingsAnalyticsPage locale={localeResolution.locale} copy={localeCopy} />
            ) : isSquadDirectory ? (
              <SquadDirectoryPage
                agents={agents}
                tasks={tasks}
                runs={runs}
                runtime={runtime}
                workspaces={workspaces}
                locale={localeResolution.locale}
                copy={localeCopy}
                navigate={navigate}
                counts={sidebarCounts}
                onDeleteAgent={deleteAgent}
                updateAgent={updateAgent}
              />
            ) : isChannels ? (
              <ChannelsPage
                channels={channels}
                channelThreads={channelThreads}
                messagesByChannel={messagesByChannel}
                agents={agents}
                activeChannelId={channelIdFromRoute(route)}
                locale={localeResolution.locale}
                copy={localeCopy}
                navigate={navigate}
                onCreateChannel={createChannel}
                onUpdateChannel={updateChannel}
                onDeleteChannel={deleteChannel}
                onToggleMember={toggleChannelMember}
                onDispatch={sendChannelPrompt}
                onFollowUp={sendThreadFollowUp}
              />
            ) : isMissionControl ? (
              <MissionControlPage
                agents={agents}
                tasks={tasks}
                runs={runs}
                runtime={runtime}
                workspaces={workspaces}
                route={route}
                locale={localeResolution.locale}
                copy={localeCopy}
                navigate={navigate}
                runsError={runsError}
                workspacesError={workspacesError}
                counts={sidebarCounts}
                onLaunchRecipe={startRecipe}
                activeAgentId={activeAgent?.id}
              />
            ) : isSettings ? (
              <SettingsPage
                themePreference={themePreference}
                setThemePreference={setThemePreference}
                handoffSettings={handoffSettings}
                setHandoffSettings={setHandoffSettings}
                chatSettings={chatSettings}
                setChatSettings={setChatSettings}
                effectiveTheme={theme}
                systemTheme={systemTheme}
                localePreference={localePreference}
                setLocalePreference={setLocalePreference}
                localeResolution={localeResolution}
                copy={localeCopy}
                runtime={runtime}
                navigate={navigate}
                providerSettings={providerSettings}
                providerSettingsError={providerSettingsError}
                initialSection={settingsSection}
                counts={sidebarCounts}
                onProviderSettingsChange={setProviderSettings}
              />
            ) : isCreate ? (
              <CreateAgent
                onCreate={createAgent}
                onCancel={() => navigate("/conversations/new")}
                defaultWorkspace={requestedWorkspace || fallbackWorkspace}
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
                memoryInbox={memoryInbox}
                saveMemoryProposalEdit={saveMemoryProposalEdit}
                acceptMemoryProposal={acceptMemoryProposal}
                rejectMemoryProposal={rejectMemoryProposal}
                hideRejectedMemory={hideRejectedMemory}
                purgeHiddenRejectedMemory={purgeHiddenRejectedMemory}
                runtime={runtime}
                workspaces={workspaces}
                runs={activeRuns}
                providerSettings={providerSettings}
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
                messagesByChannel={messagesByChannel}
                providerSettings={providerSettings}
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
                updateAgent={updateAgent}
                requestedWorkspace={requestedWorkspace}
                chatSettings={chatSettings}
                handoffRetryMode={resolveHandoffRetryMode(handoffSettings, runtime)}
                onCreateHandoff={createHandoff}
                onCollaborationResult={recordCollaborationResult}
                onCancelHandoff={cancelHandoff}
                onFailHandoff={markHandoffFailed}
                onRetryHandoff={retryHandoff}
              />
            )}
          </main>
        </div>

        {!feedbackKind && !aboutOpen ? (
          <FloatingFeedbackButton
            onReportBug={() => openFeedback("bug")}
            onGiveFeedback={() => openFeedback("feedback")}
          />
        ) : null}

        <AboutDialog
          open={aboutOpen}
          runtime={runtime}
          onOpenChange={(open) => {
            if (!open) closeAbout();
          }}
          onGiveFeedback={() => openFeedback("feedback")}
        />
        <FeedbackDialog
          kind={feedbackKind || "feedback"}
          open={Boolean(feedbackKind)}
          route={routeWithoutModalParams(route)}
          runtime={runtime}
          onOpenChange={(open) => {
            if (!open) closeFeedback();
          }}
        />

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
              tasks={tasks}
              messagesByAgent={messagesByAgent}
              messagesByChannel={messagesByChannel}
              channels={channels}
              channelThreads={channelThreads}
              sidebarCounts={sidebarCounts}
              theme={theme}
              locale={localeResolution.locale}
              copy={localeCopy}
              onSettings={() => openSettings()}
              onMissionControl={() => {
                setMobileSidebarOpen(false);
                navigate(missionControlPath());
              }}
              onOnboarding={openOnboarding}
              onAnalytics={openAnalytics}
              onCreateChannel={createChannel}
              />
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}

function appendMentionToPrompt(prompt, mention) {
  const current = String(prompt || "");
  const spacer = current && !/\s$/.test(current) ? " " : "";
  return `${current}${spacer}${mention} `.replace(/^\s+/, "");
}

function ChannelMentionComposer({ channel, members = [], copy = getLocaleCopy(DEFAULT_LOCALE), busy = false, onDispatch }) {
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const promptRef = useRef(null);
  const [mentionState, setMentionState] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const autoMode = channel?.autoModeDefault === true;
  const resolution = resolveChannelMentionTargets(prompt, channel, members);
  const targetLabel = formatChannelTargetLabel(resolution);
  const hasInvalidOnly = prompt.trim() && resolution.hasMentions && !resolution.targetAgents.length;
  const canSubmit = Boolean(prompt.trim()) && !busy && !hasInvalidOnly;
  const mentionQuery = mentionState?.query || "";
  const mentionItems = useMemo(() => {
    const query = mentionQuery.toLowerCase();
    const hereItem = {
      type: "channel",
      value: "here",
      title: "here",
      detail: "Everyone in this channel",
    };
    const memberItems = members
      .filter((member) => {
        const haystack = `${member.name || ""} ${member.role || ""} ${channelMentionHandle(member)}`.toLowerCase();
        return !query || haystack.includes(query);
      })
      .map((member) => ({
        type: "agent",
        value: channelMentionHandle(member),
        title: channelMentionHandle(member) || member.name,
        detail: localizedRole(member, copy),
        agent: member,
        presence: memberPresenceForAgent(member),
      }));
    return [
      ...(!query || "here".includes(query) ? [hereItem] : []),
      ...memberItems,
    ].slice(0, 6);
  }, [copy, members, mentionQuery]);
  const mentionOpen = Boolean(mentionState) && !busy;

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionItems.length, mentionQuery]);

  function updatePrompt(value, caret = value.length) {
    setPrompt(value);
    setMentionState(currentMentionQuery(value, caret));
    if (error) setError("");
  }

  function syncMentionFromTarget(target) {
    updatePrompt(target.value, target.selectionStart ?? target.value.length);
  }

  function selectMentionItem(item) {
    const nextPrompt = insertMentionText(prompt, item, mentionState);
    setPrompt(nextPrompt.text);
    setMentionState(null);
    setError("");
    window.requestAnimationFrame(() => {
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(nextPrompt.caret, nextPrompt.caret);
    });
  }

  function addMention(mention) {
    setPrompt((current) => appendMentionToPrompt(current, mention));
    setMentionState(null);
    setError("");
    window.requestAnimationFrame(() => {
      promptRef.current?.focus();
    });
  }

  function submit() {
    const text = prompt.trim();
    if (!text || busy) return;
    const nextResolution = resolveChannelMentionTargets(text, channel, members);
    if (nextResolution.hasMentions && !nextResolution.targetAgents.length) {
      setError("Use @here or mention a channel member by name.");
      return;
    }
    onDispatch?.({
      prompt: text,
      autoMode,
      selfJudge: autoMode,
      targetMemberIds: nextResolution.targetMemberIds,
      targetLabel: nextResolution.targetLabel,
    });
    setPrompt("");
    setMentionState(null);
    setError("");
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
        submit();
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
      submit();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>Mentions:</span>
        <Button type="button" variant="ghost" size="sm" className="h-7 rounded-md px-2" onClick={() => addMention("@here")}>
          @here
        </Button>
        {members.map((member) => (
          <Button
            key={member.id}
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-md px-2"
            onClick={() => addMention(channelMentionLabel(member))}
          >
            {channelMentionLabel(member)}
          </Button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div className="relative min-w-0 flex-1">
          {mentionOpen ? (
            <MentionPicker
              items={mentionItems}
              selectedIndex={mentionIndex}
              onSelect={selectMentionItem}
            />
          ) : null}
          <Textarea
            ref={promptRef}
            value={prompt}
            placeholder="Use @here for everyone or @Noah for one member..."
            rows={2}
            className="min-h-[64px] resize-none"
            disabled={busy}
            aria-label={copy.channelPromptPlaceholder || "Channel prompt"}
            onChange={(event) => syncMentionFromTarget(event.target)}
            onClick={(event) => syncMentionFromTarget(event.currentTarget)}
            onKeyDown={handlePromptKeyDown}
            onKeyUp={(event) => {
              if (mentionOpen && ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"].includes(event.key)) return;
              syncMentionFromTarget(event.currentTarget);
            }}
            onSelect={(event) => syncMentionFromTarget(event.currentTarget)}
          />
        </div>
        <Button size="icon" aria-label={copy.channels} disabled={!canSubmit} onClick={submit}>
          <Send />
        </Button>
      </div>
      <p className={cn("text-xs", error || hasInvalidOnly ? "text-destructive" : "text-muted-foreground")}>
        {error || (hasInvalidOnly ? "Use @here or mention a channel member by name." : null) ||
          `Target: ${targetLabel || "channel"}. ${autoMode ? copy.channelAutoModeOn : copy.channelAutoModeOff}.`}
      </p>
    </div>
  );
}

function threadReplyLabel(count) {
  const value = Number(count) || 0;
  return value === 1 ? "1 reply" : `${value} replies`;
}

function messageCreatedTime(message, locale = DEFAULT_LOCALE) {
  return message?.time || formatShortTime(message?.createdAt || message?.startedAt || message?.updatedAt || "", locale);
}

function ChannelUserAvatar({ className }) {
  return (
    <Avatar className={cn("size-8 rounded-md border border-border/70 bg-primary/12", className)}>
      <AvatarFallback className="rounded-md bg-primary/12 text-primary">
        <span className="text-xs font-semibold">{ACCOUNT_PROFILE.initials || "IC"}</span>
      </AvatarFallback>
    </Avatar>
  );
}

function ChannelMessageAvatar({ message, agents = [], className }) {
  if (message?.role === "user") return <ChannelUserAvatar className={className} />;
  const agent = agents.find((item) => item.id === message?.agentId);
  return agent ? (
    <AgentAvatar agent={agent} className={cn("size-8 rounded-md", className)} />
  ) : (
    <Avatar className={cn("size-8 rounded-md border border-border/70 bg-muted", className)}>
      <AvatarFallback className="rounded-md bg-muted text-muted-foreground">
        <span className="text-xs font-semibold">S</span>
      </AvatarFallback>
    </Avatar>
  );
}

function channelMessageAuthorName(message, agents = [], userName = ACCOUNT_PROFILE.name) {
  if (message?.role === "user") return userName;
  const agent = agents.find((item) => item.id === message?.agentId);
  return agent?.name || message?.authorName || "Squad member";
}

function ChannelThreadMessage({ message, agents = [], userName = ACCOUNT_PROFILE.name, locale = DEFAULT_LOCALE }) {
  const loading = message?.status === "loading";
  const error = message?.status === "error";
  return (
    <div className="group flex gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-muted/30">
      <ChannelMessageAvatar message={message} agents={agents} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-semibold leading-5">{channelMessageAuthorName(message, agents, userName)}</span>
          {messageCreatedTime(message, locale) ? (
            <span className="text-xs text-muted-foreground">{messageCreatedTime(message, locale)}</span>
          ) : null}
          {loading ? <Spinner className="size-3" /> : null}
        </div>
        <div className={cn("mt-0.5 text-sm leading-6", error ? "text-destructive" : "text-foreground/90")}>
          <MarkdownBlocks text={message?.body || ""} />
        </div>
      </div>
    </div>
  );
}

function ChannelReplyPreview({ replies = [], replyCount = 0, agents = [], expanded = false, onToggle }) {
  const replyAgents = replies
    .map((message) => agents.find((agent) => agent.id === message.agentId))
    .filter(Boolean);
  const uniqueReplyAgents = Array.from(new Map(replyAgents.map((agent) => [agent.id, agent])).values());
  const loading = replies.some((message) => message.status === "loading");
  const completedCount = replies.filter((message) => message.status === "complete").length;
  const count = Math.max(Number(replyCount) || 0, replies.length, completedCount);

  return (
    <button
      type="button"
      className="ml-11 mt-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="flex -space-x-1.5">
        {uniqueReplyAgents.slice(0, 3).map((agent) => (
          <AgentAvatar key={agent.id} agent={agent} className="size-5 rounded-md border-background" />
        ))}
        {!uniqueReplyAgents.length ? (
          <span className="grid size-5 place-items-center rounded-md bg-muted text-[10px] text-muted-foreground">
            <MessageSquareText className="size-3" />
          </span>
        ) : null}
      </span>
      <span className="font-medium text-primary">{threadReplyLabel(count)}</span>
      {loading ? <Spinner className="size-3" /> : null}
      <span className="truncate">{expanded ? "Collapse thread" : "View thread"}</span>
      {expanded ? <ChevronDown className="ml-auto size-3.5 shrink-0" /> : <ChevronRight className="ml-auto size-3.5 shrink-0" />}
    </button>
  );
}

function ChannelThreadItem({
  thread,
  rootMessage,
  replies = [],
  agents = [],
  userName = ACCOUNT_PROFILE.name,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  locale = DEFAULT_LOCALE,
  busy = false,
  onFollowUp,
}) {
  const [expanded, setExpanded] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const replyCount = replies.length || Number(thread?.replyCount || 0);

  function submitFollowUp() {
    const text = followUp.trim();
    if (!text || busy) return;
    onFollowUp?.({ prompt: text, threadId: thread.id });
    setFollowUp("");
    setExpanded(true);
  }

  return (
    <section className="group border-b border-border/70 pb-4 last:border-b-0" aria-label={thread.title || "Channel thread"}>
      {rootMessage ? (
        <ChannelThreadMessage message={rootMessage} agents={agents} userName={userName} locale={locale} />
      ) : null}

      <div className="ml-11 mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {thread.autoMode === true ? <Badge variant="secondary" className="rounded-md px-1.5 py-0">Auto mode on</Badge> : null}
        {thread.targetLabel ? <span>{thread.targetLabel}</span> : null}
      </div>

      {replyCount > 0 ? (
        <ChannelReplyPreview
          replies={replies}
          replyCount={replyCount}
          agents={agents}
          expanded={expanded}
          onToggle={() => setExpanded((open) => !open)}
        />
      ) : (
        <button
          type="button"
          className="ml-11 mt-1 rounded-md px-1 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide reply composer" : copy.threadFollowUp}
        </button>
      )}

      {expanded ? (
        <div className="ml-11 mt-3 border-l border-border/80 pl-4">
          {replyCount > 0 ? (
            <div className="mb-3 flex items-center gap-3 text-sm text-muted-foreground">
              <span>{threadReplyLabel(replyCount)}</span>
              <Separator className="min-w-0 flex-1" />
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            {replies.map((message) => (
              <ChannelThreadMessage
                key={message.id}
                message={message}
                agents={agents}
                userName={userName}
                locale={locale}
              />
            ))}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <Textarea
              value={followUp}
              placeholder={copy.threadFollowUpPlaceholder}
              rows={1}
              className="min-h-[40px] flex-1 resize-none"
              disabled={busy}
              aria-label={copy.threadFollowUp}
              onChange={(event) => setFollowUp(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitFollowUp();
                }
              }}
            />
            <Button variant="outline" size="sm" disabled={busy || !followUp.trim()} onClick={submitFollowUp}>
              {copy.threadFollowUp}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// Squad channels: channel list + channel detail flow. One prompt fans out to
// every member assigned to the selected channel; replies stay grouped in
// threads. Auto mode (self-judge) is a channel-level toggle that defaults OFF.
function ChannelsPage({
  channels = [],
  channelThreads = {},
  messagesByChannel = {},
  agents = [],
  activeChannelId = "",
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  navigate,
  onCreateChannel,
  onUpdateChannel,
  onDeleteChannel,
  onToggleMember,
  onDispatch,
  onFollowUp,
}) {
  const [manageMembersOpen, setManageMembersOpen] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const channel = channels.find((item) => item.id === activeChannelId) || null;
  const threads = channel ? channelThreads[channel.id] || [] : [];
  const channelMessages = channel ? messagesByChannel[channel.id] || [] : [];
  const members = channel
    ? channel.memberIds.map((memberId) => agents.find((agent) => agent.id === memberId)).filter(Boolean)
    : [];

  useEffect(() => {
    setManageMembersOpen(false);
    setDeleteArmed(false);
  }, [activeChannelId]);

  function exportChannelLog() {
    if (!channel) return;
    const markdown = buildChannelMarkdownLog({
      channel,
      threads,
      messages: channelMessages,
      agents,
      userName: ACCOUNT_PROFILE.name,
      locale,
    });
    downloadMarkdownLog(`${sanitizeMarkdownFilename(channel.name)}-chat-log.md`, markdown);
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-56px)] w-full max-w-5xl flex-col px-4 py-4 lg:min-h-screen lg:px-10 lg:py-7">
      <ChannelCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        agents={agents}
        copy={copy}
        onCreateChannel={onCreateChannel}
      />

        {!channel ? (
          <div className="flex flex-1 flex-col items-start justify-center gap-2">
            <p className="text-sm text-muted-foreground">
              {channels.length ? copy.channelSelectPrompt : copy.channelNoChannels}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">{copy.channelsDescription}</p>
            <Button variant="outline" className="mt-3" onClick={() => setCreateOpen(true)}>
              <Plus data-icon="inline-start" />
              {copy.createChannel}
            </Button>
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-start justify-between gap-3 pb-3">
              <div className="min-w-0">
                <h1 className="flex items-center gap-2 text-lg font-semibold">
                  {channel.visibility === CHANNEL_VISIBILITY_PRIVATE ? (
                    <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <Hash className="size-4 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="min-w-0 truncate">{channel.name}</span>
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {channel.visibility === CHANNEL_VISIBILITY_PRIVATE ? copy.channelPrivate : copy.channelPublic}
                  {" · "}
                  {formatCopy(copy.channelMemberCount, { count: formatLocalizedNumber(channel.memberIds.length, locale) })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground" htmlFor={`auto-mode-${channel.id}`}>
                  {copy.channelAutoMode}
                  <Switch
                    id={`auto-mode-${channel.id}`}
                    checked={channel.autoModeDefault === true}
                    onCheckedChange={(checked) => onUpdateChannel?.(channel.id, { autoModeDefault: checked === true })}
                  />
                </label>
                <Button variant="ghost" size="sm" onClick={exportChannelLog}>
                  <FileCode2 data-icon="inline-start" />
                  Export markdown
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setManageMembersOpen((open) => !open)}>
                  {copy.manageChannelMembers}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (!deleteArmed) {
                      setDeleteArmed(true);
                      return;
                    }
                    onDeleteChannel?.(channel.id);
                  }}
                  onBlur={() => setDeleteArmed(false)}
                >
                  {deleteArmed ? `${copy.deleteChannel}?` : copy.deleteChannel}
                </Button>
              </div>
            </header>

            {manageMembersOpen ? (
              <div className="flex flex-col gap-2 pb-3">
                <p className="text-xs text-muted-foreground">{copy.channelMembersDetail}</p>
                <div className="flex flex-wrap gap-1.5">
                  {agents.map((agent) => {
                    const isMember = channel.memberIds.includes(agent.id);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        aria-pressed={isMember}
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-sm transition-colors",
                          isMember
                            ? "border-primary/50 bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground hover:bg-muted/45 hover:text-foreground"
                        )}
                        onClick={() => onToggleMember?.(channel.id, agent.id)}
                      >
                        {agent.name} · {isMember ? copy.leaveChannel : copy.joinChannel}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="pb-3 text-sm text-muted-foreground">
                {members.length ? members.map((member) => member.name).join(", ") : copy.channelNoMembers}
              </p>
            )}

            <Separator />

            <ScrollArea className="min-h-0 flex-1 py-4">
              {threads.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.channelNoThreads}</p>
              ) : (
                <div className="flex flex-col gap-5 pr-3">
                  {threads.map((thread) => {
                    const threadMessages = channelMessages.filter((message) => message.threadId === thread.id);
                    const rootMessage =
                      threadMessages.find((message) => message.id === `${thread.id}-root`) ||
                      threadMessages.find((message) => message.role === "user");
                    const recordedReplyCount =
                      Number.isFinite(Number(thread.replyCount)) && Number(thread.replyCount) > 0
                        ? Math.floor(Number(thread.replyCount))
                        : 0;
                    const fallbackRootMessage =
                      !rootMessage && (thread.title || recordedReplyCount > 0)
                        ? {
                            id: `${thread.id}-summary`,
                            role: "user",
                            body: [
                              thread.title || copy.channelThreads,
                              recordedReplyCount > 0
                                ? `${formatLocalizedNumber(recordedReplyCount, locale)} replies were recorded in this thread, but their message bodies are not loaded in this browser session.`
                                : "",
                            ]
                              .filter(Boolean)
                              .join("\n\n"),
                            status: "complete",
                            time: "",
                            threadId: thread.id,
                            parentMessageId: "",
                          }
                        : rootMessage;
                    const replies = threadMessages.filter((message) => message.id !== rootMessage?.id);
                    const busy = replies.some((message) => message.status === "loading");
                    return (
                      <ChannelThreadItem
                        key={thread.id}
                        thread={thread}
                        rootMessage={fallbackRootMessage}
                        replies={replies}
                        agents={agents}
                        userName={ACCOUNT_PROFILE.name}
                        copy={copy}
                        locale={locale}
                        busy={busy}
                        onFollowUp={({ prompt }) => onFollowUp?.(channel.id, thread.id, prompt)}
                      />
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            <div className="pt-2">
              <ChannelMentionComposer
                channel={channel}
                members={members}
                copy={copy}
                busy={false}
                onDispatch={({ prompt, autoMode, selfJudge, targetMemberIds, targetLabel }) =>
                  onDispatch?.(channel.id, { prompt, autoMode, selfJudge, targetMemberIds, targetLabel })
                }
              />
            </div>
          </>
        )}
    </div>
  );
}

function OnboardingPage({
  runtime,
  providerSettings,
  providerSettingsError = "",
  workspaces = [],
  agents = [],
  activeAgent,
  fallbackWorkspace = "",
  requestedWorkspace = "",
  onboardingState,
  loginRequestStatus = "",
  navigate,
  updateOnboardingState,
  onRequestLogin,
  onRefreshAccount,
  onFinish,
  onSkip,
}) {
  const selectedWorkspace = onboardingState.selectedWorkspace || requestedWorkspace || fallbackWorkspace || "";
  const workspaceChoices = workspaceOptions(workspaces, selectedWorkspace, runtime);
  const runtimeReady = runtime?.available === true;
  const accountReady = onboardingAccountReady(runtime);
  const providerReady = onboardingProviderReady(providerSettings);
  const workspaceReady = Boolean(selectedWorkspace);
  const customMemberExists = agents.length > initialAgents.length;
  const memberReady = onboardingState.memberReady || customMemberExists;
  const finishReady = runtimeReady && accountReady && providerReady && workspaceReady && memberReady;
  const skipReady = accountReady;
  const completedSteps = [runtimeReady, accountReady, providerReady, workspaceReady, memberReady].filter(Boolean).length;
  const progress = Math.round((completedSteps / 5) * 100);
  const defaultModel = providerSettings
    ? providerSummaryLabel(effectiveModelForAgent({ modelAssignment: { mode: "inherit" } }, providerSettings))
    : "Loading providers";
  const accountLabel = runtime?.account?.email || (accountReady ? "Signed in" : "Not signed in");
  const starterMember = activeAgent || agents[0];

  useEffect(() => {
    if (!onboardingState.selectedWorkspace && selectedWorkspace) {
      updateOnboardingState({ selectedWorkspace, lastStep: "workspace" });
    }
  }, [onboardingState.selectedWorkspace, selectedWorkspace, updateOnboardingState]);

  function selectWorkspace(value) {
    updateOnboardingState({ selectedWorkspace: value, lastStep: "workspace" });
  }

  function openProviderSettings() {
    updateOnboardingState({ lastStep: "providers" });
    navigate("/settings?section=providers");
  }

  function createFirstMember() {
    updateOnboardingState({ lastStep: "member" });
    navigate(routeWithParams(`${MEMBER_ROUTE_PREFIX}/new`, { workspace: selectedWorkspace || null }));
  }

  function useStarterMember() {
    updateOnboardingState({ memberReady: true, lastStep: "member" });
  }

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Welcome to Autohand Squad" />
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-10 lg:py-10">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="flex items-center gap-3">
            <BrandMark theme="dark" className="size-9 dark:hidden" />
            <BrandMark theme="light" className="hidden size-9 dark:block" />
            <div className="min-w-0">
              <div className="text-sm font-semibold">Autohand Squad</div>
              <div className="text-xs text-muted-foreground">First-run setup</div>
            </div>
          </div>

          <div className="mt-7">
            <Progress value={progress} />
            <div className="mt-2 text-xs text-muted-foreground">{completedSteps} of 5 setup checks ready</div>
          </div>

          <div className="mt-7 divide-y divide-border/70 text-sm">
            <OnboardingStepLine ready={runtimeReady} label="Runtime" detail={runtime?.version || "Checking local bridge"} />
            <OnboardingStepLine ready={accountReady} label="Account" detail={accountLabel} />
            <OnboardingStepLine ready={providerReady} label="LLM provider" detail={defaultModel} />
            <OnboardingStepLine ready={workspaceReady} label="Workspace" detail={workspaceLabel(selectedWorkspace, workspaces)} />
            <OnboardingStepLine ready={memberReady} label="Squad member" detail={memberReady ? "Ready for first work" : "Choose starter or create one"} />
          </div>
        </aside>

        <main className="min-w-0">
          <header className="border-b border-border/70 pb-8">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" className="rounded-md">Welcome</Badge>
              <span>Setup stays local and can be resumed from the account menu.</span>
            </div>
            <h1 className="mt-4 text-balance text-4xl font-semibold tracking-normal sm:text-5xl">Set up the squad before the first run.</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Autohand Squad gives each digital teammate an isolated CLI profile, project scope, provider settings, and work history. This setup connects those pieces once so the main product opens ready for real work.
            </p>
          </header>

          <div className="divide-y divide-border/70">
            <section className="grid gap-5 py-8 lg:grid-cols-[220px_minmax(0,1fr)]">
              <OnboardingSectionTitle icon={Server} title="Runtime" description="Confirm the local Autohand bridge and CLI are visible." />
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={runtimeReady ? "ready" : "offline"} copy={getLocaleCopy(DEFAULT_LOCALE)} />
                  <span className="min-w-0 truncate text-sm text-muted-foreground">{runtime?.autohandPath || "Autohand CLI path not found yet"}</span>
                </div>
                {!runtimeReady ? (
                  <Alert>
                    <AlertTriangle />
                    <AlertTitle>Runtime is not ready</AlertTitle>
                    <AlertDescription>Install the Autohand CLI or restart Autohand Squad, then refresh this page.</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            </section>

            <section className="grid gap-5 py-8 lg:grid-cols-[220px_minmax(0,1fr)]">
              <OnboardingSectionTitle icon={KeyRound} title="Account" description="Use the existing Squad browser login flow." />
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={accountReady ? "ready" : "offline"} copy={getLocaleCopy(DEFAULT_LOCALE)} />
                  <span className="text-sm text-muted-foreground">{accountLabel}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={onRequestLogin} disabled={accountReady}>
                    <KeyRound data-icon="inline-start" />
                    {accountReady ? "Signed in" : "Open browser login"}
                  </Button>
                  <Button type="button" variant="outline" onClick={onRefreshAccount}>
                    <RefreshCw data-icon="inline-start" />
                    Refresh status
                  </Button>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  This calls the installed `autohand-squad-tray --action login` path, so browser/device auth and local runtime account state stay owned by the existing desktop controller.
                </p>
                {loginRequestStatus ? <p className="text-sm text-muted-foreground">{loginRequestStatus}</p> : null}
              </div>
            </section>

            <section className="grid gap-5 py-8 lg:grid-cols-[220px_minmax(0,1fr)]">
              <OnboardingSectionTitle icon={Brain} title="LLM provider" description="Reuse the workspace provider registry." />
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={providerReady ? "ready" : "offline"} copy={getLocaleCopy(DEFAULT_LOCALE)} />
                  <span className="text-sm text-muted-foreground">{defaultModel}</span>
                </div>
                {providerSettingsError ? (
                  <Alert>
                    <AlertTriangle />
                    <AlertTitle>Provider settings need attention</AlertTitle>
                    <AlertDescription>{providerSettingsError}</AlertDescription>
                  </Alert>
                ) : null}
                <div>
                  <Button type="button" variant={providerReady ? "outline" : "default"} onClick={openProviderSettings}>
                    <Settings data-icon="inline-start" />
                    {providerReady ? "Review provider settings" : "Configure provider"}
                  </Button>
                </div>
              </div>
            </section>

            <section className="grid gap-5 py-8 lg:grid-cols-[220px_minmax(0,1fr)]">
              <OnboardingSectionTitle icon={FolderGit2} title="Workspace" description="Choose the repository or project for first work." />
              <FieldGroup>
                <Field>
                  <FieldLabel>First workspace</FieldLabel>
                  <Select value={selectedWorkspace} onValueChange={selectWorkspace}>
                    <SelectTrigger className="h-10 w-full min-w-0 justify-between">
                      <SelectValue placeholder="Select a workspace" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Folders under {runtime?.workspaceRoot || "your user directory"}</SelectLabel>
                        {workspaceChoices.map((workspace) => (
                          <SelectItem key={workspace.path} value={workspace.path}>
                            {workspace.label || workspace.name || workspaceName(workspace.path)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>{selectedWorkspace || "This workspace is passed into first conversations, runs, and new squad members."}</FieldDescription>
                </Field>
              </FieldGroup>
            </section>

            <section className="grid gap-5 py-8 lg:grid-cols-[220px_minmax(0,1fr)]">
              <OnboardingSectionTitle icon={Users} title="First squad member" description="Start from a template or use the existing starter member." />
              <div className="grid gap-4">
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <AgentAvatar agent={starterMember} className="size-10" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{starterMember?.name || "Starter member"}</div>
                    <div className="truncate text-sm text-muted-foreground">{starterMember?.role || "Ready to adapt to first work"}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={createFirstMember}>
                    <Plus data-icon="inline-start" />
                    Create first member
                  </Button>
                  <Button type="button" variant="outline" onClick={useStarterMember} disabled={memberReady}>
                    <CheckCircle2 data-icon="inline-start" />
                    {memberReady ? "Member ready" : "Use starter member"}
                  </Button>
                </div>
              </div>
            </section>
          </div>

          <footer className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t bg-background/95 px-4 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:mx-0 lg:px-0">
            <div className="text-sm text-muted-foreground">
              {!accountReady
                ? "Sign in to continue. Public beta access requires an Autohand account."
                : finishReady
                  ? "Setup is ready. Start the first conversation from the real product surface."
                  : "You can skip optional setup now and return from the account menu."}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={onSkip} disabled={!skipReady}>Skip for now</Button>
              <Button type="button" disabled={!finishReady} onClick={onFinish}>
                <Play data-icon="inline-start" />
                Finish and start
              </Button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

function OnboardingSectionTitle({ icon: Icon, title, description }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-primary" />
        <span>{title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function OnboardingStepLine({ ready, label, detail }) {
  return (
    <div className="flex gap-3 py-3">
      <span className={cn("mt-1 size-2 rounded-full", ready ? "bg-primary" : "bg-muted-foreground/40")} />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </div>
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
  const readyBody = `${agent?.name || "Squad member"} is online. Pick a workspace and chat normally. This squad member keeps its isolated config for local work.`;
  const legacyRunControlName = "play" + " button";
  const legacyReadyBody = `${agent?.name || "Squad member"} is online. Pick a workspace, chat normally, or use the ${legacyRunControlName} when you want an explicit Autohand run. Both paths use this squad member's isolated config.`;
  return {
    ...message,
    body: [readyBody, legacyReadyBody].includes(message?.body) ? formatCopy(copy.agentOnlineMessage, { name: agent?.name || copy.squadMember }) : message?.body,
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
      answer: String(
        structured.answer ||
          structured.response ||
          structured.reply ||
          structured.text ||
          structured.output ||
          (typeof structured.message === "string" ? structured.message : "") ||
          structured.content ||
          ""
      ).trim(),
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

function humanReadableReplyText(reply, trace, fallback = "") {
  const replyText = String(reply || "").trim();
  const parsedReply = parseAgentBody(replyText);
  if (parsedReply.answer) return parsedReply.answer;

  const normalizedTrace = normalizeTrace(trace);
  const traceMessage = [...normalizedTrace.messages]
    .reverse()
    .find((message) => message.content && message.content.trim());
  if (traceMessage?.content) return traceMessage.content.trim();

  const stdoutAnswer = parseAgentBody(normalizedTrace.raw.stdout).answer;
  if (stdoutAnswer) return stdoutAnswer;

  return replyText || String(fallback || "").trim();
}

function channelStreamingReplyText(agentName, streamedAnswer) {
  const text = String(streamedAnswer || "").trim();
  if (!text) return `${agentName} is typing...`;
  if (/^[{[]/.test(text)) return `${agentName} is replying...`;
  return text;
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
        if (event.type === "status") return event.title || event.status;
        if (event.type === "error") return event.title || event.content;
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
      if (event.type === "status") return `status:${event.status || ""}:${event.title || ""}:${event.timestamp || ""}`;
      if (event.type === "error") return `error:${event.title || event.content || ""}:${event.timestamp || ""}`;
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

function durationFromMessage(message) {
  const explicit = Number(message?.durationMs ?? message?.trace?.durationMs);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.round(explicit);

  const started = Date.parse(message?.startedAt || message?.trace?.startedAt || "");
  const completed = Date.parse(message?.completedAt || message?.trace?.completedAt || "");
  if (!Number.isNaN(started) && !Number.isNaN(completed) && completed >= started) {
    return completed - started;
  }

  return null;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1000) return `${Math.max(1, Math.round(value))} ms`;
  if (value < 10000) return `${(value / 1000).toFixed(1)}s`;
  if (value < 60000) return `${Math.round(value / 1000)}s`;
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function useElapsedMs(startedAt, active) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || !startedAt) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  const started = Date.parse(startedAt || "");
  return Number.isNaN(started) ? null : Math.max(0, now - started);
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
  const permissions = resolveAgentPermissionsForWorkspace(agent, workspace);
  const ladder = autonomyLadderLevelMeta(permissions.ladderLevel);
  const toolPolicyEntries = Object.entries(permissions.builtInPolicies);
  const allowedToolCount = toolPolicyEntries.filter(([, mode]) => mode === "allow").length;
  const approvalToolCount = toolPolicyEntries.filter(([, mode]) => mode === "ask").length;
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
    formatBrainCardForPrompt(agent),
    workspace ? `Selected repository folder for this run: ${workspace}` : "",
    projects.length ? `Associated repositories/projects:\n${projects.map((project) => `- ${project.label || project.name}: ${project.path}`).join("\n")}` : "",
    `Autohand Skills registry: ${agent?.skillSource || AUTOHAND_SKILLS_REGISTRY_URL}`,
    agent?.id ? `Agent profile map: .autohand/agents/${agent.id}/AGENTS.md` : "",
    agent?.id ? `Agent profile files: .autohand/agents/${agent.id}/profile` : "",
    agent?.id ? `Profile skills install target: .autohand/agents/${agent.id}/skills` : "",
    `Autonomy ladder: Level ${ladder.rank} - ${ladder.label}`,
    `Autonomy ladder summary: ${ladder.summary}`,
    `Permission mode: ${permissions.permissionMode}`,
    `Built-in CLI tools: ${allowedToolCount} autonomous, ${approvalToolCount} ask first, ${blockedToolCount} blocked.`,
    permissions.sensitivePaths.length ? `Sensitive path guard entries: ${permissions.sensitivePaths.length}` : "",
    "Auto-merge is disabled for this squad member. PR preparation can be approved when configured, but merge authority stays with the user.",
    "This process is launched for one Autohand Squad member. Keep memory, sessions, and configuration isolated to that squad member's Autohand home.",
    "Use the agent profile map to decide which profile Markdown files to read; do not assume every profile file must be loaded for every task.",
    "The structured brain card is the source of truth for how this squad member thinks, works, escalates, reviews, and handles memory.",
    "The profile skills are installed from the curated Autohand Skills repository. Activate and use the relevant installed skills when they match the user's request.",
    "When the user sends a message in Autohand Squad, answer as this configured CLI instance and keep all work scoped to the selected folder unless the user explicitly changes it.",
    Array.isArray(agent?.skills) && agent.skills.length ? `Profile skills: ${agent.skills.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function collaborationMemoryLines(agent, label) {
  const memory = Array.isArray(agent?.memory) ? agent.memory.filter(Boolean) : [];
  if (!memory.length) return [`${label} memory: none saved yet.`];
  return [
    `${label} memory:`,
    ...memory.slice(0, 8).map((item) => `- ${item}`),
  ];
}

function collaborationTaskLines(task) {
  if (!task) return ["Parent task: no existing parent task; create one from this live conversation."];
  const lines = [
    `Parent task: ${task.title || task.id || "Untitled task"}`,
    task.id ? `Parent task id: ${task.id}` : "",
    task.status ? `Parent task status: ${task.status}` : "",
    task.summary ? `Parent task summary: ${task.summary}` : "",
  ].filter(Boolean);
  const timeline = Array.isArray(task.timeline) ? task.timeline : [];
  const recentEvents = timeline.slice(-4).map((event) => event.summary || event.content).filter(Boolean);
  if (recentEvents.length) {
    lines.push("Recent task timeline:", ...recentEvents.map((event) => `- ${event}`));
  }
  return lines;
}

function buildCollaborationProfileContext(collaboration, agents = [], workspaces = []) {
  if (!collaboration || typeof collaboration !== "object") return "";
  const sourceAgent = agents.find((item) => item.id === collaboration.sourceAgentId);
  const targetAgent = agents.find((item) => item.id === collaboration.targetAgentId);
  const task = collaboration.task && typeof collaboration.task === "object" ? collaboration.task : null;
  const handoff = collaboration.handoff && typeof collaboration.handoff === "object" ? collaboration.handoff : null;
  const role = collaboration.role === "receiver" ? "receiving" : "source";
  const workspace = collaboration.workspace ? workspaceLabel(collaboration.workspace, workspaces) : "";

  return [
    "Autohand Squad collaboration context",
    `Collaboration role: ${role}`,
    sourceAgent ? `Source member: ${sourceAgent.name} (${sourceAgent.role || "Squad member"})` : "",
    targetAgent ? `Receiving member: ${targetAgent.name} (${targetAgent.role || "Squad member"})` : "",
    workspace ? `Shared workspace: ${workspace}` : "",
    ...collaborationTaskLines(task),
    handoff?.reason ? `Handoff reason: ${handoff.reason}` : "",
    handoff?.requiredContext ? `Required context: ${handoff.requiredContext}` : "",
    handoff?.expectedOutput ? `Expected output: ${handoff.expectedOutput}` : "",
    handoff?.sourceEvidence ? `Source evidence: ${handoff.sourceEvidence}` : "",
    collaboration.originalPrompt ? `Original user message: ${collaboration.originalPrompt}` : "",
    ...collaborationMemoryLines(sourceAgent, "Source member"),
    ...collaborationMemoryLines(targetAgent, "Receiving member"),
    role === "source"
      ? "When the user asks you to involve another squad member, acknowledge it plainly, coordinate through the shared handoff, and do not pretend the receiving member has answered until their result is recorded."
      : "You are picking up a live handoff from another squad member. Acknowledge that you have it, use the shared task/project/member memory above, do the requested work, and produce a result the source member can bring back to the user.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Squad channels: profile context appended when a channel prompt is dispatched
// to a member. Explains the one-prompt fan-out contract and states the channel
// auto-mode/self-judge runtime default (OFF unless the channel enables it).
function buildChannelProfileContext(channel, agent, agents = [], { autoMode, selfJudge, threadId, targetMemberIds = [], targetLabel = "" } = {}) {
  if (!channel || !agent) return "";
  const roster = (channel.memberIds || [])
    .map((memberId) => agents.find((item) => item.id === memberId))
    .filter(Boolean)
    .map((member) => `- ${member.name}${member.role ? ` (${member.role})` : ""}`);
  const targetRoster = (targetMemberIds.length ? targetMemberIds : channel.memberIds || [])
    .map((memberId) => agents.find((item) => item.id === memberId))
    .filter(Boolean)
    .map((member) => `- ${member.name}${member.role ? ` (${member.role})` : ""}`);
  const targeted = targetMemberIds.length > 0 && targetMemberIds.length < (channel.memberIds || []).length;
  return [
    "Autohand Squad channel context",
    `Channel: #${channel.name} (${channel.visibility})`,
    threadId ? `Thread: ${threadId}` : "",
    roster.length ? `Channel members:\n${roster.join("\n")}` : "",
    targetRoster.length ? `Selected recipients${targetLabel ? ` (${targetLabel})` : ""}:\n${targetRoster.join("\n")}` : "",
    targeted
      ? `You are ${agent.name}. The user mentioned you for this channel thread. Reply in a natural, human way to the user and keep the answer scoped to your role.`
      : `You are ${agent.name}. This prompt was sent once to the channel recipients; choose your own execution plan and post your reply in the thread. Other selected members reply in the same thread, so keep your answer scoped to your role.`,
    "Return a conversational answer only. Do not expose SDK event objects, JSON envelopes, raw tool traces, or transport metadata in the user-facing reply.",
    autoMode || selfJudge
      ? "Auto mode (self-judge): ON for this thread. Judge your own result and continue without waiting for approval."
      : "Auto mode (self-judge): OFF for this thread. Pause and ask before destructive or ambiguous actions; the user reviews each step.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCollaborationRecipientPrompt(handoffResult, originalPrompt, workspaces = []) {
  const targetName = handoffResult?.targetAgent?.name || "receiving squad member";
  const sourceName = handoffResult?.sourceAgent?.name || "the source squad member";
  const handoff = handoffResult?.handoff || {};
  const workspace = handoffResult?.workspace ? workspaceLabel(handoffResult.workspace, workspaces) : "";
  return [
    `${targetName}, ${sourceName} is handing you a live conversation.`,
    "Start by acknowledging that you picked it up, then continue the work from the shared context.",
    workspace ? `Shared workspace: ${workspace}` : "",
    handoff.reason ? `Reason: ${handoff.reason}` : "",
    handoff.requiredContext ? `Required context: ${handoff.requiredContext}` : "",
    handoff.expectedOutput ? `Expected output: ${handoff.expectedOutput}` : "",
    handoff.sourceEvidence ? `Source evidence: ${handoff.sourceEvidence}` : "",
    originalPrompt ? `Original user message: ${originalPrompt}` : "",
    "Return a concise result that can be brought back to the source conversation.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function agentLaunchPayload(agent, workspace) {
  const permissions = resolveAgentPermissionsForWorkspace(agent, workspace || agent?.workspace);
  return {
    id: agent?.id,
    staffId: agent?.staffId,
    name: agent?.name,
    role: agent?.role,
    description: agent?.description,
    instructions: agent?.instructions,
    brainCard: brainCardForAgent(agent),
    skillSource: agent?.skillSource || AUTOHAND_SKILLS_REGISTRY_URL,
    skillInstall: agent?.skillInstall,
    skills: normalizeSkillList(agent?.skills),
    projects: normalizeAgentProjects(agent?.projects, agent?.workspace),
    profileFiles: buildAgentProfileFiles(agent),
    profileDocs: agent?.profileDocs,
    modelAssignment: modelAssignmentForAgent(agent),
    permissions,
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

function ChannelCreateDialog({
  open,
  onOpenChange,
  agents = [],
  copy = getLocaleCopy(DEFAULT_LOCALE),
  onCreateChannel,
}) {
  const [draftName, setDraftName] = useState("");
  const [draftVisibility, setDraftVisibility] = useState(CHANNEL_VISIBILITY_PUBLIC);
  const [draftMemberIds, setDraftMemberIds] = useState([]);
  const [draftAutoMode, setDraftAutoMode] = useState(false);
  const [closedAfterSubmit, setClosedAfterSubmit] = useState(false);

  function resetDraft() {
    setDraftName("");
    setDraftVisibility(CHANNEL_VISIBILITY_PUBLIC);
    setDraftMemberIds([]);
    setDraftAutoMode(false);
  }

  function setOpen(nextOpen) {
    if (nextOpen) setClosedAfterSubmit(false);
    onOpenChange?.(nextOpen);
    if (!nextOpen) resetDraft();
  }

  function toggleDraftMember(agentId) {
    setDraftMemberIds((current) =>
      current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId]
    );
  }

  function submitCreate(event) {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) return;
    setClosedAfterSubmit(true);
    onCreateChannel?.({
      name,
      visibility: draftVisibility,
      memberIds: draftMemberIds,
      autoModeDefault: draftAutoMode === true,
    });
    onOpenChange?.(false);
    resetDraft();
  }

  return (
    <Dialog open={open && !closedAfterSubmit} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[440px]">
        <form onSubmit={submitCreate} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{copy.createChannel}</DialogTitle>
            <DialogDescription>{copy.channelsDescription}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-name">{copy.channelName}</Label>
            <Input
              id="channel-name"
              value={draftName}
              placeholder={copy.channelNamePlaceholder}
              autoFocus
              onChange={(event) => setDraftName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{copy.channelVisibility}</Label>
            <div className="flex flex-col gap-1">
              {CHANNEL_VISIBILITY_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = draftVisibility === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    className={cn(
                      "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                      selected ? "bg-muted/80" : "hover:bg-muted/45"
                    )}
                    onClick={() => setDraftVisibility(option.id)}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{copy[option.labelKey]}</span>
                      <span className="block text-xs text-muted-foreground">{copy[option.detailKey]}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{copy.channelMembers}</Label>
            <p className="text-xs text-muted-foreground">{copy.channelMembersDetail}</p>
            <div className="flex flex-wrap gap-1.5">
              {agents.map((agent) => {
                const selected = draftMemberIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    aria-pressed={selected}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-sm transition-colors",
                      selected
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/45 hover:text-foreground"
                    )}
                    onClick={() => toggleDraftMember(agent.id)}
                  >
                    {agent.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="channel-auto-mode">{copy.channelAutoMode}</Label>
              <p className="mt-1 text-xs text-muted-foreground">{copy.channelAutoModeDetail}</p>
            </div>
            <Switch
              id="channel-auto-mode"
              checked={draftAutoMode}
              onCheckedChange={(checked) => setDraftAutoMode(checked === true)}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!draftName.trim()}>
              {copy.createChannel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SidebarChannelsSection({
  channels = [],
  agents = [],
  activeChannelId = "",
  active = false,
  expanded = false,
  threadCounts = {},
  copy = getLocaleCopy(DEFAULT_LOCALE),
  onExpandedChange,
  onOpenChannels,
  onSelectChannel,
  onCreateChannel,
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const ToggleIcon = expanded ? ChevronDown : ChevronRight;

  function openCreateDialog() {
    onExpandedChange?.(true);
    setCreateOpen(true);
  }

  return (
    <div className="flex min-h-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          className={cn(
            "h-11 min-w-0 flex-1 justify-start rounded-md px-2.5 text-muted-foreground hover:bg-muted/55 hover:text-foreground",
            active && "bg-muted/80 text-foreground"
          )}
          aria-expanded={expanded}
          aria-controls="squad-sidebar-channels"
          aria-current={active ? "page" : undefined}
          onClick={() => {
            onExpandedChange?.(!expanded);
            if (!active) onOpenChannels?.();
          }}
        >
          <ToggleIcon data-icon="inline-start" className="size-3.5" />
          <Hash data-icon="inline-start" />
          <span className="min-w-0 flex-1 truncate">{copy.channels}</span>
          <Badge variant="secondary" className="rounded-md px-1.5">
            {channels.length}
          </Badge>
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={copy.createChannel} onClick={openCreateDialog}>
          <Plus />
        </Button>
      </div>

      {expanded ? (
        <div id="squad-sidebar-channels" className="ml-7 flex flex-col gap-0.5">
          {channels.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">{copy.channelNoChannels}</p>
          ) : (
            channels.map((channel) => {
              const isActive = channel.id === activeChannelId;
              const threadCount = threadCounts[channel.id] || 0;
              return (
                <button
                  key={channel.id}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    isActive ? "bg-muted/80 text-foreground" : "text-foreground/85 hover:bg-muted/55"
                  )}
                  onClick={() => onSelectChannel?.(channel.id)}
                >
                  {channel.visibility === CHANNEL_VISIBILITY_PRIVATE ? (
                    <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label={copy.channelPrivate} />
                  ) : (
                    <Hash className="size-3.5 shrink-0 text-muted-foreground" aria-label={copy.channelPublic} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                  {threadCount > 0 ? (
                    <Badge variant="secondary" className="rounded-md px-1.5">
                      {threadCount}
                    </Badge>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}

      <ChannelCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        agents={agents}
        copy={copy}
        onCreateChannel={onCreateChannel}
      />
    </div>
  );
}

function CollapsedSidebarRail({
  agents,
  activeAgent,
  navigate,
  route,
  theme,
  tasks = [],
  runs = [],
  messagesByAgent = {},
  messagesByChannel = {},
  channelCount = 0,
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  sidebarCounts = EMPTY_MISSION_COUNTS,
  onSettings,
  onMissionControl,
  onOnboarding,
  onAnalytics,
  onExpand,
}) {
  const visibleAgents = agents.filter((agent) => agent?.id && agent?.name);
  const memberId = activeAgent?.id || visibleAgents[0]?.id;
  const isCreatingMember = isCreateMemberRoute(route);
  const isMemberProfile = isMemberProfileRoute(route);
  const isMissionControl = route.split("?")[0] === MISSION_CONTROL_ROUTE;
  const isSquadDirectory = route.split("?")[0] === SQUAD_DIRECTORY_ROUTE;
  const isChannelsRoute = route.split("?")[0].startsWith(CHANNELS_ROUTE);

  if (isMemberProfile && activeAgent) {
    return (
      <CollapsedMemberProfileRail
        agent={activeAgent}
        activeSection={memberSectionFromRoute(route)}
        copy={copy}
        navigate={navigate}
        theme={theme}
        sidebarCounts={sidebarCounts}
        onSettings={onSettings}
        onMissionControl={onMissionControl}
        onOnboarding={onOnboarding}
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
            onClick={() => navigate(squadDirectoryPath())}
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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-9 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg:not([class*='size-'])]:size-4",
                isSquadDirectory && "bg-accent text-foreground"
              )}
              onClick={() => navigate(squadDirectoryPath())}
              aria-label={`Squad directory, ${visibleAgents.length} members`}
            >
              <Users className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Squad</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "relative size-9 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg:not([class*='size-'])]:size-4",
                isChannelsRoute && "bg-accent text-foreground"
              )}
              onClick={() => navigate(channelsPath())}
              aria-label={`${copy.channels}, ${channelCount} channels`}
            >
              <Hash className="size-4" />
              <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                {channelCount}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copy.channels}</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="mt-5 min-h-0 w-full flex-1">
        <nav aria-label={copy.mySquadMembers} className="flex flex-col items-center gap-3 pb-4">
          {visibleAgents.map((agent) => {
            const isActive =
              activeAgent?.id === agent.id && !isCreatingMember && !isMissionControl && !isSquadDirectory && !isChannelsRoute;
            const presence = memberPresenceForAgent(agent, { tasks, runs, messagesByAgent, messagesByChannel });
            return (
              <Tooltip key={agent.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    aria-label={`${agent.name}, ${presence.label}, ${agent.role || copy.squadMember}`}
                    className={cn(
                      "relative grid size-9 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
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
                    <MemberPresenceBadge presence={presence} className="absolute bottom-0 right-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {agent.name}
                  {agent.role ? `, ${agent.role}` : ""}
                  {" · "}
                  {presence.description}
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
          onMissionControl={onMissionControl}
          onOnboarding={onOnboarding}
          onAnalytics={onAnalytics}
          placement="right-start"
          triggerClassName="size-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg:not([class*='size-'])]:size-4"
        />
      </div>
    </div>
  );
}

function CollapsedMemberProfileRail({ agent, activeSection, theme, copy = getLocaleCopy(DEFAULT_LOCALE), navigate, sidebarCounts = EMPTY_MISSION_COUNTS, onSettings, onMissionControl, onOnboarding, onAnalytics, onExpand }) {
  return (
    <div className="flex h-full min-h-screen w-[72px] flex-col items-center bg-card/95 px-2 py-3.5 text-card-foreground dark:bg-black">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-9 rounded-lg hover:bg-transparent"
            onClick={() => navigate(squadDirectoryPath())}
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
          onMissionControl={onMissionControl}
          onOnboarding={onOnboarding}
          onAnalytics={onAnalytics}
          placement="right-start"
          triggerClassName="size-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg:not([class*='size-'])]:size-4"
        />
      </div>
    </div>
  );
}

function SidebarContent({
  agents,
  activeAgent,
  navigate,
  route,
  theme,
  tasks = [],
  runs = [],
  messagesByAgent = {},
  messagesByChannel = {},
  channels = [],
  channelThreads = {},
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  sidebarCounts = EMPTY_MISSION_COUNTS,
  onSettings,
  onMissionControl,
  onOnboarding,
  onAnalytics,
  onCollapse,
  onCreateChannel,
}) {
  const visibleAgents = agents.filter((agent) => agent?.id && agent?.name);
  const memberId = activeAgent?.id || visibleAgents[0]?.id;
  const chatPath = memberChatPath(memberId);
  const isCreatingMember = isCreateMemberRoute(route);
  const isMemberProfile = isMemberProfileRoute(route);
  const routePath = route.split("?")[0];
  const isMissionControl = routePath === MISSION_CONTROL_ROUTE;
  const isSquadDirectory = routePath === SQUAD_DIRECTORY_ROUTE;
  const isChannelsRoute = routePath.startsWith(CHANNELS_ROUTE);
  const activeChannelId = channelIdFromRoute(route);
  const [channelsExpanded, setChannelsExpanded] = useState(isChannelsRoute);
  const channelThreadCounts = useMemo(() => {
    const counts = {};
    for (const [channelId, records] of Object.entries(channelThreads)) {
      counts[channelId] = Array.isArray(records) ? records.length : 0;
    }
    return counts;
  }, [channelThreads]);

  useEffect(() => {
    if (isChannelsRoute) setChannelsExpanded(true);
  }, [isChannelsRoute]);

  if (isMemberProfile && activeAgent) {
    return (
      <MemberProfileSidebar
        agent={activeAgent}
        activeSection={memberSectionFromRoute(route)}
        copy={copy}
        navigate={navigate}
        theme={theme}
        sidebarCounts={sidebarCounts}
        onSettings={onSettings}
        onMissionControl={onMissionControl}
        onOnboarding={onOnboarding}
        onAnalytics={onAnalytics}
        onCollapse={onCollapse}
      />
    );
  }

  return (
    <div className="flex h-full min-h-screen flex-col bg-card/70">
      <div className="flex h-14 items-center gap-2 px-4">
        <Button variant="ghost" className="h-10 justify-start gap-2 px-1 hover:bg-transparent" onClick={() => navigate(squadDirectoryPath())}>
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
          variant="ghost"
          className={cn(
            "h-11 w-full justify-start rounded-md px-3 text-muted-foreground hover:bg-muted/55 hover:text-foreground",
            isSquadDirectory && "bg-muted/80 text-foreground"
          )}
          onClick={() => navigate(squadDirectoryPath())}
          aria-current={isSquadDirectory ? "page" : undefined}
        >
          <Users data-icon="inline-start" />
          <span className="min-w-0 flex-1 truncate">Squad</span>
          <Badge variant="secondary" className="rounded-md px-1.5">
            {formatLocalizedNumber(visibleAgents.length, locale)}
          </Badge>
        </Button>

        <SidebarChannelsSection
          channels={channels}
          agents={visibleAgents}
          activeChannelId={activeChannelId}
          active={isChannelsRoute}
          expanded={channelsExpanded}
          threadCounts={channelThreadCounts}
          copy={copy}
          onExpandedChange={setChannelsExpanded}
          onOpenChannels={() => navigate(channelsPath())}
          onSelectChannel={(channelId) => navigate(channelsPath(channelId))}
          onCreateChannel={onCreateChannel}
        />

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
              const isActive =
                activeAgent?.id === agent.id && !isCreatingMember && !isMissionControl && !isSquadDirectory && !isChannelsRoute;
              const presence = memberPresenceForAgent(agent, { tasks, runs, messagesByAgent, messagesByChannel });
              return (
                <button
                  key={agent.id}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  aria-label={`${agent.name}, ${presence.label}, ${agentSidebarPreview(agent)}`}
                  className={cn(
                    "grid min-h-[66px] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                    isActive ? "bg-muted/80 text-foreground" : "text-foreground/88 hover:bg-muted/55"
                  )}
                  onClick={() => navigate(memberChatPath(agent.id))}
                >
                  <span className="relative size-8">
                    <AgentAvatar agent={agent} />
                    <MemberPresenceBadge presence={presence} className="absolute -bottom-0.5 -right-0.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{agent.name}</span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
                      <span className={cn("shrink-0 font-medium", presence.textClassName)}>{presence.label}</span>
                      <span className="text-muted-foreground/60" aria-hidden="true">·</span>
                      <span className="min-w-0 truncate text-muted-foreground">{agentSidebarPreview(agent)}</span>
                    </span>
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

      <SidebarAccountFooter copy={copy} onSettings={onSettings} onMissionControl={onMissionControl} onOnboarding={onOnboarding} onAnalytics={onAnalytics} />
    </div>
  );
}

function MemberProfileSidebar({ agent, activeSection, theme, copy = getLocaleCopy(DEFAULT_LOCALE), navigate, sidebarCounts = EMPTY_MISSION_COUNTS, onSettings, onMissionControl, onOnboarding, onAnalytics, onCollapse }) {
  return (
    <div className="flex h-full min-h-screen flex-col bg-background">
      <div className="flex h-14 items-center gap-2 px-4">
        <Button
          variant="ghost"
          className="h-10 min-w-0 justify-start gap-2 px-1 hover:bg-transparent"
          onClick={() => navigate(squadDirectoryPath())}
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

      <SidebarAccountFooter copy={copy} onSettings={onSettings} onMissionControl={onMissionControl} onOnboarding={onOnboarding} onAnalytics={onAnalytics} />
    </div>
  );
}

function SidebarAccountFooter({ copy = getLocaleCopy(DEFAULT_LOCALE), onSettings, onMissionControl, onOnboarding, onAnalytics }) {
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
        <AccountMenuButton copy={copy} onSettings={onSettings} onMissionControl={onMissionControl} onOnboarding={onOnboarding} onAnalytics={onAnalytics} />
      </div>
    </div>
  );
}

function AccountMenuButton({
  copy = getLocaleCopy(DEFAULT_LOCALE),
  onSettings,
  onMissionControl,
  onOnboarding,
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
          <AccountMenuItem icon={ListChecks} label="Setup guide" onClick={() => choose(onOnboarding)} hasChevron />
          <AccountMenuItem icon={Monitor} label="Mission Control" onClick={() => choose(onMissionControl)} hasChevron />
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

function MobileTopbar({ activeAgent, theme, copy = getLocaleCopy(DEFAULT_LOCALE), onMenu, onSettings, onMissionControl, onOnboarding, onAnalytics }) {
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
      <AccountMenuButton copy={copy} onSettings={onSettings} onMissionControl={onMissionControl} onOnboarding={onOnboarding} onAnalytics={onAnalytics} placement="bottom-end" />
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


function ConversationWelcome({ agent, copy, onPrompt }) {
  const suggestions = [
    "Help me fix {bug ID} in {repository}, finish the code changes, and prepare a PR.",
    "Help me check this component for interaction, accessibility, and responsive issues.",
    "Help me improve this frontend page's visual hierarchy and loading performance.",
  ];
  const roleLabel = localizedRole(agent, copy);

  return (
    <div className="mx-auto flex w-full max-w-[min(48rem,100%)] flex-col items-center justify-center gap-4 overflow-hidden px-2 py-4 text-center sm:gap-6 sm:py-8 lg:py-10">
      <AgentAvatar agent={agent} large className="size-16 sm:size-20" />
      <div className="space-y-2">
        <h1 className="max-w-full text-balance text-xl font-semibold tracking-normal text-foreground sm:text-3xl">Hello, how can I help you today?</h1>
        <p className="max-w-full text-balance text-sm text-muted-foreground">I am your {roleLabel}, ready to complete any task you assign.</p>
      </div>
      <div className="grid w-full max-w-full gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="group flex min-h-12 w-full max-w-full items-center gap-3 overflow-hidden rounded-md bg-muted/50 px-3 py-2.5 text-left text-sm font-medium text-foreground/90 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            onClick={() => onPrompt(suggestion)}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-background text-muted-foreground transition-colors group-hover:text-foreground">
              <Sparkles className="size-4" />
            </span>
            <span className="min-w-0 flex-1 break-words leading-5">{suggestion}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Conversation({
  agent,
  agents = [],
  messages = [],
  runtime,
  workspaces,
  runs,
  messagesByChannel = {},
  providerSettings,
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
  updateAgent,
  requestedWorkspace,
  chatSettings = DEFAULT_CHAT_SETTINGS,
  handoffRetryMode = DEFAULT_HANDOFF_RETRY_MODE,
  onCreateHandoff,
  onCollaborationResult,
  onCancelHandoff,
  onFailHandoff,
  onRetryHandoff,
}) {
  const defaultLaunch = agent.launch || { mode: "prompt", policy: "restricted", model: "", dryRun: false };
  const defaultWorkspace =
    requestedWorkspace && !isBlockedWorkspace(requestedWorkspace, runtime)
      ? requestedWorkspace
      : getAgentWorkspace(agent, runtime, workspaces);
  const [promptByAgent, setPromptByAgent] = useState({});
  const [workspace, setWorkspace] = useState(defaultWorkspace);
  const [mode, setMode] = useState(defaultLaunch.mode);
  const [policy, setPolicy] = useState(defaultLaunch.policy);
  const [model, setModel] = useState(defaultLaunch.model || "");
  const [dryRun, setDryRun] = useState(defaultLaunch.dryRun);
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [panelTab, setPanelTab] = useState("runs");
  const [profilePreviewOpen, setProfilePreviewOpen] = useState(false);
  const [automationFormOpen, setAutomationFormOpen] = useState(false);
  // Goal 09: recipe catalog + launch state for the composer.
  const [recipeCatalogOpen, setRecipeCatalogOpen] = useState(false);
  const [recipeLaunchTarget, setRecipeLaunchTarget] = useState(null);
  // Goal 08: pre-launch context pack preview state.
  const [packPreview, setPackPreview] = useState(null);
  const [packPreviewOpen, setPackPreviewOpen] = useState(false);
  const [packPreviewLoading, setPackPreviewLoading] = useState(false);
  const [packPreviewError, setPackPreviewError] = useState("");
  const [chatSendingByAgent, setChatSendingByAgent] = useState({});
  const [queuedFollowupsByAgent, setQueuedFollowupsByAgent] = useState({});
  const chatSendingRef = useRef({});
  const queuedFollowupsRef = useRef({});
  const activeChatControllerRef = useRef({});
  const promptRef = useRef(null);
  const messagesEndRef = useRef(null);
  const [mentionState, setMentionState] = useState(null);
  const [mentionFiles, setMentionFiles] = useState([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const activeMode = RUN_MODES.find((item) => item.id === mode) || RUN_MODES[0];
  const prompt = promptByAgent[agent.id] || "";
  const chatSending = chatSendingByAgent[agent.id] === true;
  const queuedFollowups = queuedFollowupsByAgent[agent.id] || [];
  // Goal 09: recommend recipes from the current request, scoped to this member's role.
  const recommendedRecipeMatches = useMemo(
    () => recommendRecipesForPrompt(prompt, RECIPE_CATALOG, agentRoleId(agent)),
    [prompt, agent]
  );
  const latestRun = runs[0];
  const workspaceChoices = workspaceOptions(workspaces, workspace, runtime);
  const maxProjects = configuredProjectLimit(runtime);
  const projects = useMemo(
    () => normalizeAgentProjects(agent.projects, agent.workspace, workspaces, maxProjects),
    [agent.projects, agent.workspace, maxProjects, workspaces]
  );
  const projectPathKey = projects.map((project) => project.path).join("\n");
  const projectPaths = useMemo(() => new Set(projects.map((project) => project.path)), [projectPathKey]);
  const addWorkspaceChoices = useMemo(
    () =>
      workspaceOptions(workspaces, workspaceDraft, runtime).filter(
        (item) => !projectPaths.has(normalizeSquadWorkspacePath(item.path, runtime))
      ),
    [projectPathKey, projectPaths, runtime, workspaceDraft, workspaces]
  );
  const normalizedWorkspaceDraft = normalizeSquadWorkspacePath(workspaceDraft, runtime);
  const selectedAddWorkspaceValue = addWorkspaceChoices.some((item) => item.path === normalizedWorkspaceDraft)
    ? normalizedWorkspaceDraft
    : undefined;
  const atProjectLimit = projects.length >= maxProjects;
  const duplicateWorkspace = Boolean(normalizedWorkspaceDraft && projectPaths.has(normalizedWorkspaceDraft));
  const blockedWorkspaceDraft = Boolean(normalizedWorkspaceDraft && isBlockedWorkspace(normalizedWorkspaceDraft, runtime));
  const canAddWorkspace = Boolean(normalizedWorkspaceDraft) && !atProjectLimit && !duplicateWorkspace && !blockedWorkspaceDraft;
  const blockedWorkspace = isBlockedWorkspace(workspace, runtime);
  const launchPermissions = resolveAgentPermissionsForWorkspace(agent, workspace);
  const launchWarnings = launchPermissionWarnings({ permissions: launchPermissions, prompt, mode, policy });
  const effectiveModel = effectiveModelForAgent(agent, providerSettings);
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
        presence: memberPresenceForAgent(item, { tasks, runs, messagesByChannel }),
      }));
  }, [agent.id, agents, copy, mentionQuery, messagesByChannel, runs, tasks]);
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
    () => messages.filter((message) => !(message?.id === "m1" && message?.role === "agent" && message?.time === "Ready")),
    [messages]
  );
  const hasConversationMessages = visibleMessages.length > 0;
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
    setWorkspaceError("");
  }, [agent.id, workspaceDraft]);

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
    setPromptByAgent((current) => ({ ...current, [agent.id]: value }));
    setMentionState(currentMentionQuery(value, caret));
  }

  function syncMentionFromTarget(target) {
    updatePrompt(target.value, target.selectionStart ?? target.value.length);
  }

  function selectMentionItem(item) {
    const nextPrompt = insertMentionText(prompt, item, mentionState);
    setPromptByAgent((current) => ({ ...current, [agent.id]: nextPrompt.text }));
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
    return onCreateHandoff(
      {
        type: "chat-mention",
        task: sourceTask,
        sourceAgentId: agent.id,
        workspace,
        autoAccept: true,
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

  function collaborationLaunchPayload(handoffResult, role, promptText) {
    return {
      role,
      sourceAgentId: handoffResult?.sourceAgentId,
      targetAgentId: handoffResult?.targetAgentId,
      task: handoffResult?.task || null,
      handoff: handoffResult?.handoff || null,
      workspace: handoffResult?.workspace || workspace,
      originalPrompt: promptText,
    };
  }

  function setActiveChatSending(agentId, nextValue) {
    chatSendingRef.current = { ...chatSendingRef.current, [agentId]: nextValue };
    setChatSendingByAgent((current) => ({ ...current, [agentId]: nextValue }));
  }

  function setQueuedFollowupItems(agentId, nextItems) {
    queuedFollowupsRef.current = { ...queuedFollowupsRef.current, [agentId]: nextItems };
    setQueuedFollowupsByAgent((current) => ({ ...current, [agentId]: nextItems }));
  }

  function updateQueuedFollowups(updater) {
    const nextItems = updater(queuedFollowupsRef.current[agent.id] || []);
    setQueuedFollowupItems(agent.id, nextItems);
  }

  function queuedFollowupFromPrompt(nextPrompt) {
    return {
      id: `followup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      prompt: nextPrompt.trim(),
      workspace,
      policy,
      model,
    };
  }

  function queuePrompt(nextPrompt) {
    const queuedPrompt = String(nextPrompt || "").trim();
    if (!queuedPrompt) return;
    updateQueuedFollowups((items) => [...items, queuedFollowupFromPrompt(queuedPrompt)]);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function updateQueuedFollowupPrompt(itemId, nextPrompt) {
    updateQueuedFollowups((items) =>
      items.map((item) => (item.id === itemId ? { ...item, prompt: nextPrompt } : item))
    );
  }

  function removeQueuedFollowup(itemId) {
    updateQueuedFollowups((items) => items.filter((item) => item.id !== itemId));
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function sendNextQueuedFollowup(agentId = agent.id) {
    if (chatSendingRef.current[agentId]) return;
    const [nextItem, ...remainingItems] = queuedFollowupsRef.current[agentId] || [];
    if (!nextItem) return;
    setQueuedFollowupItems(agentId, remainingItems);
    sendPromptNow(nextItem, { agentId, restorePromptOnError: true });
  }

  function sendPromptNow(nextItem, options = {}) {
    const targetAgentId = options.agentId || agent.id;
    const submittedPrompt = String(nextItem.prompt || "").trim();
    if (!submittedPrompt || blockedWorkspace) return;

    const controller = new AbortController();
    activeChatControllerRef.current = { ...activeChatControllerRef.current, [targetAgentId]: controller };
    setActiveChatSending(targetAgentId, true);

    try {
      const handoffResult = createMentionHandoff(submittedPrompt);
      const sourceLaunch = handoffResult
        ? {
            ...nextItem,
            collaboration: collaborationLaunchPayload(handoffResult, "source", submittedPrompt),
          }
        : nextItem;
      const chatPromise = Promise.resolve(
        onChat(targetAgentId, {
          prompt: sourceLaunch.prompt || submittedPrompt,
          workspace: sourceLaunch.workspace || workspace,
          policy: sourceLaunch.policy || policy,
          model: sourceLaunch.model || model,
          collaboration: sourceLaunch.collaboration,
          signal: controller.signal,
        })
      );
      void chatPromise
        .then(() => {
          if (controller.signal.aborted) return;
          if (!handoffResult?.targetAgentId) return;
          const receiverController = new AbortController();
          activeChatControllerRef.current = {
            ...activeChatControllerRef.current,
            [handoffResult.targetAgentId]: receiverController,
          };
          setActiveChatSending(handoffResult.targetAgentId, true);
          const receiverPrompt = buildCollaborationRecipientPrompt(handoffResult, submittedPrompt, workspaces);
          void Promise.resolve(
            onChat(handoffResult.targetAgentId, {
              prompt: receiverPrompt,
              workspace: handoffResult.workspace || sourceLaunch.workspace || workspace,
              policy: sourceLaunch.policy || policy,
              model: sourceLaunch.model || model,
              collaboration: collaborationLaunchPayload(handoffResult, "receiver", submittedPrompt),
              signal: receiverController.signal,
            })
          )
            .then((result) => {
              onCollaborationResult?.(handoffResult, result || {});
            })
            .catch((error) => {
              onCollaborationResult?.(handoffResult, {
                error: error?.message || "Receiving member could not complete the handoff.",
              });
            })
            .finally(() => {
              if (activeChatControllerRef.current[handoffResult.targetAgentId] === receiverController) {
                activeChatControllerRef.current = {
                  ...activeChatControllerRef.current,
                  [handoffResult.targetAgentId]: null,
                };
              }
              setActiveChatSending(handoffResult.targetAgentId, false);
            });
        })
        .catch(() => {})
        .finally(() => {
          if (activeChatControllerRef.current[targetAgentId] === controller) {
            activeChatControllerRef.current = { ...activeChatControllerRef.current, [targetAgentId]: null };
          }
          setActiveChatSending(targetAgentId, false);
          window.setTimeout(() => sendNextQueuedFollowup(targetAgentId), 0);
        });
    } catch {
      if (activeChatControllerRef.current[targetAgentId] === controller) {
        activeChatControllerRef.current = { ...activeChatControllerRef.current, [targetAgentId]: null };
      }
      setActiveChatSending(targetAgentId, false);
      if (options.restorePromptOnError) {
        setPromptByAgent((current) => ({ ...current, [targetAgentId]: submittedPrompt }));
      }
    }
  }

  useEffect(() => {
    if (typeof window === "undefined" || !window.__AUTOHAND_SQUAD_VERIFY__) return undefined;
    window.__AUTOHAND_SQUAD_VERIFY_SEND__ = (nextPrompt) => {
      sendPromptNow({ prompt: String(nextPrompt || ""), workspace, policy, model }, { agentId: agent.id, restorePromptOnError: true });
    };
    return () => {
      if (window.__AUTOHAND_SQUAD_VERIFY_SEND__) {
        delete window.__AUTOHAND_SQUAD_VERIFY_SEND__;
      }
    };
  }, [agent.id, model, policy, workspace]);

  function stopActiveChat() {
    activeChatControllerRef.current[agent.id]?.abort();
  }

  function submit(event) {
    event.preventDefault();
    if (!prompt.trim() || blockedWorkspace) return;
    const submittedPrompt = prompt.trim();
    setPromptByAgent((current) => ({ ...current, [agent.id]: "" }));
    setMentionState(null);
    if (chatSendingRef.current[agent.id]) {
      queuePrompt(submittedPrompt);
      return;
    }
    sendPromptNow({ prompt: submittedPrompt, workspace, policy, model }, { agentId: agent.id, restorePromptOnError: true });
  }

  // Goal 08: preview the context pack before launching a run. Calls the server
  // generator and opens the same inspect dialog used in the run timeline.
  async function previewContextPack() {
    if (blockedWorkspace) return;
    setPackPreviewLoading(true);
    setPackPreviewError("");
    setPackPreviewOpen(true);
    try {
      const pack = await api("/api/context-pack", {
        method: "POST",
        body: JSON.stringify({
          agentId: agent.id,
          mode,
          prompt: prompt.trim(),
          workspace,
          activeRoute: typeof window !== "undefined" ? window.location.pathname : "",
          agent: agentLaunchPayload(agent, workspace),
        }),
      });
      setPackPreview(pack);
    } catch (error) {
      setPackPreview(null);
      setPackPreviewError(error.message || "Could not generate context pack.");
    } finally {
      setPackPreviewLoading(false);
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

  // Goal 09: launch a recipe through the shared launch flow (onStart =
  // startAutohand), passing recipeId plus the current prompt as context.
  function launchRecipe({ recipe, agentId, prompt: recipePrompt }) {
    const resolved = recipe;
    if (!resolved || !onStart) return;
    const targetAgentId = agentId || agent.id;
    const requestText = String(recipePrompt || prompt || "").trim() || `Run recipe "${resolved.name}": ${resolved.description}`;
    setRecipeCatalogOpen(false);
    setRecipeLaunchTarget(null);
    onStart(targetAgentId, {
      recipeId: resolved.id,
      prompt: requestText,
      workspace,
      mode: "goal",
      dryRun: false,
    });
    setPromptByAgent((current) => ({ ...current, [agent.id]: "" }));
    setTaskPanelOpen(true);
  }

  function startFreshChat() {
    stopActiveChat();
    setQueuedFollowupItems(agent.id, []);
    setPromptByAgent((current) => ({ ...current, [agent.id]: "" }));
    setMentionState(null);
    onNewConversation?.(agent.id);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function chooseSuggestion(nextPrompt) {
    setPromptByAgent((current) => ({ ...current, [agent.id]: nextPrompt }));
    setMentionState(null);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  function addWorkspaceFromComposer() {
    if (!updateAgent) {
      setWorkspaceError("Workspace editing is unavailable.");
      return;
    }
    if (atProjectLimit) {
      setWorkspaceError("Workspace limit reached (" + maxProjects + ").");
      return;
    }
    if (!normalizedWorkspaceDraft) {
      setWorkspaceError(copy.selectWorkspace || "Select workspace");
      return;
    }
    if (blockedWorkspaceDraft) {
      setWorkspaceError(copy.chooseProjectFolder || "Choose a project folder or git repo.");
      return;
    }
    if (duplicateWorkspace) {
      setWorkspaceError("Workspace already added.");
      return;
    }

    const project = projectRecordFromPath({ path: normalizedWorkspaceDraft, addedAt: new Date().toISOString() }, workspaces);
    if (!project) {
      setWorkspaceError("Workspace path is not valid.");
      return;
    }

    const nextProjects = [...projects, project].slice(0, maxProjects);
    updateAgent(agent.id, {
      projects: nextProjects,
      workspace: project.path,
      stats: { ...(agent.stats || {}), projects: nextProjects.length },
      updatedAt: new Date().toISOString(),
    });
    setWorkspace(project.path);
    setWorkspaceDraft("");
    setWorkspaceError("");
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-[560px] w-full max-w-full flex-col overflow-x-hidden bg-background/75 lg:h-screen lg:min-h-screen">
      <header className="flex min-h-16 max-w-full flex-col gap-3 overflow-hidden border-b bg-background/92 px-4 py-3 backdrop-blur-xl sm:px-6 xl:flex-row xl:items-center xl:justify-between xl:gap-5">
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
              <span className="min-w-0 max-w-32 truncate sm:max-w-[20rem] md:max-w-[32rem]">{workspaceName(workspace) || workspaceLabel(workspace, workspaces)}</span>
              <span className="hidden min-w-0 max-w-48 truncate sm:inline">{providerSummaryLabel(effectiveModel)}</span>
              <span className={cn("size-1.5 rounded-full", runtime?.available ? "bg-primary" : "bg-destructive")} />
              <span className="hidden sm:inline">{runtime?.available ? copy.localCliReady : copy.autohandMissing}</span>
            </div>
          </div>
        </div>

        <div className="flex w-full max-w-full flex-wrap items-center gap-2 overflow-hidden sm:w-auto">
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
          <Button variant={runningCount ? "secondary" : "ghost"} size="sm" className="hidden sm:inline-flex" onClick={() => openPanel("runs")}>
            <CircleDot data-icon="inline-start" className={cn(runningCount && "text-primary")} />
            {copy.current}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1">
          <div
            className={cn(
              "mx-auto flex w-full max-w-5xl flex-col px-4 py-5 pb-40 sm:px-6 lg:py-8",
              hasConversationMessages ? "gap-5" : "justify-start lg:min-h-[calc(100svh-18rem)] lg:justify-center"
            )}
          >
            {hasConversationMessages ? (
              <>
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
                    <SquadMessage
                      key={message.id}
                      agent={agent}
                      message={localizedMessage(message, agent, copy)}
                      copy={copy}
                      chatSettings={chatSettings}
                    />
                  ))}
                  <div ref={messagesEndRef} aria-hidden="true" />
                </div>
              </>
            ) : (
              <ConversationWelcome agent={agent} copy={copy} onPrompt={chooseSuggestion} />
            )}
          </div>
        </ScrollArea>

        <form className="border-t bg-background px-3 py-3 sm:px-5" onSubmit={submit}>
          {recommendedRecipeMatches.length && !chatSending ? (
            <RecipeRecommendationPanel
              recipes={recommendedRecipeMatches}
              copy={copy}
              onSelect={(recipe) => setRecipeLaunchTarget(recipe)}
            />
          ) : null}
          <div className="mx-auto flex w-full max-w-3xl flex-col rounded-xl border bg-background transition-colors focus-within:border-ring/70">
            {queuedFollowups.length ? (
              <QueuedFollowups
                items={queuedFollowups}
                copy={copy}
                onChange={updateQueuedFollowupPrompt}
                onRemove={removeQueuedFollowup}
              />
            ) : null}
            {launchWarnings.length ? <LaunchPermissionWarnings warnings={launchWarnings} /> : null}
            <div className="flex flex-col gap-2 p-2">
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
                  className="max-h-56 min-h-24 resize-none border-0 bg-transparent px-3 py-3 text-base shadow-none focus-visible:ring-0 md:text-sm"
                />
              </div>
              <div className="flex min-w-0 items-center gap-1.5 px-1 pb-1 sm:gap-2">
              <Select value={blockedWorkspace ? undefined : workspace} onValueChange={setWorkspace} disabled={!workspaceChoices.length}>
                <SelectTrigger className="h-9 w-0 min-w-0 basis-0 grow overflow-hidden rounded-full border-0 bg-muted px-3 shadow-none hover:bg-accent sm:w-auto sm:max-w-72 sm:basis-auto sm:grow-0">
                  <FolderGit2 className="shrink-0" />
                  <span className="min-w-0 truncate">{blockedWorkspace ? copy.selectWorkspace : workspaceName(workspace) || workspaceLabel(workspace, workspaces)}</span>
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

              <Popover
                onOpenChange={(open) => {
                  if (open && !workspaceDraft && addWorkspaceChoices[0]?.path) {
                    setWorkspaceDraft(addWorkspaceChoices[0].path);
                  }
                }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label={copy.addWorkspace}>
                        <Plus />
                      </Button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{copy.addWorkspace}</TooltipContent>
                </Tooltip>
                <PopoverContent side="top" align="start" sideOffset={10} className="w-[min(24rem,calc(100vw-2rem))] p-3">
                  <FieldGroup className="gap-4">
                    <Field className="gap-2">
                      <FieldLabel>{copy.selectWorkspace}</FieldLabel>
                      <Select
                        value={selectedAddWorkspaceValue}
                        onValueChange={(value) => {
                          setWorkspaceDraft(value);
                          setWorkspaceError("");
                        }}
                        disabled={atProjectLimit || !addWorkspaceChoices.length}
                      >
                        <SelectTrigger className="h-9 w-full">
                          <FolderGit2 />
                          <SelectValue placeholder={copy.selectWorkspace} />
                        </SelectTrigger>
                        <SelectContent position="popper" className="max-h-[320px]">
                          <SelectGroup>
                            <SelectLabel>{copy.localFolders}</SelectLabel>
                            {addWorkspaceChoices.map((item) => (
                              <SelectItem key={item.path} value={item.path}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field className="gap-2">
                      <FieldLabel>Path</FieldLabel>
                      <Input
                        value={workspaceDraft}
                        onChange={(event) => {
                          setWorkspaceDraft(event.target.value);
                          setWorkspaceError("");
                        }}
                        placeholder="/Users/name/path/to/repository"
                        disabled={atProjectLimit}
                        className="h-9 font-mono text-xs"
                      />
                    </Field>

                    {workspaceError ? <FieldDescription className="text-destructive">{workspaceError}</FieldDescription> : null}

                    <Button type="button" size="sm" className="w-full" disabled={!canAddWorkspace || !updateAgent} onClick={addWorkspaceFromComposer}>
                      <Plus data-icon="inline-start" />
                      {copy.addWorkspace}
                    </Button>
                  </FieldGroup>
                </PopoverContent>
              </Popover>

              <Popover>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label={copy.settings}>
                        <SlidersHorizontal />
                      </Button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{copy.settings}</TooltipContent>
                </Tooltip>
                <PopoverContent side="top" align="end" sideOffset={10} className="w-[min(22rem,calc(100vw-2rem))] p-3">
                  <FieldGroup className="gap-4">
                    <Field className="gap-2">
                      <FieldLabel>{copy.mode}</FieldLabel>
                      <ToggleGroup
                        type="single"
                        value={mode}
                        onValueChange={(value) => value && setMode(value)}
                        variant="outline"
                        className="grid w-full grid-cols-3"
                        spacing={0}
                      >
                        {RUN_MODES.map((item) => (
                          <ToggleGroupItem key={item.id} value={item.id} className="h-8 min-w-0 px-2 text-xs">
                            <span className="truncate">{runModeLabel(item.id, copy)}</span>
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </Field>

                    <Field className="gap-2">
                      <FieldLabel>{copy.policy}</FieldLabel>
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
                    </Field>

                    <Field className="gap-2">
                      <FieldLabel>{copy.model}</FieldLabel>
                      <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder={copy.model} className="h-9" />
                    </Field>

                    <Field orientation="horizontal" className="items-center justify-between gap-4 rounded-md border bg-background px-3 py-2">
                      <FieldContent className="gap-0.5">
                        <FieldTitle>{copy.dryRun}</FieldTitle>
                      </FieldContent>
                      <Switch checked={dryRun} onCheckedChange={setDryRun} />
                    </Field>

                    <Separator />

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => setRecipeCatalogOpen(true)}
                    >
                      <BookOpen data-icon="inline-start" />
                      {recipeCopy(copy).browseRecipes}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      disabled={blockedWorkspace || packPreviewLoading}
                      onClick={previewContextPack}
                    >
                      <Boxes data-icon="inline-start" />
                      {copy.contextPack?.previewToggle || "Preview context pack before launch"}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      disabled={!prompt.trim() || blockedWorkspace}
                      onClick={() => openTerminal({ ...agent, workspace }, prompt)}
                    >
                      <TerminalSquare data-icon="inline-start" />
                      {copy.openInTerminal}
                    </Button>
                  </FieldGroup>
                </PopoverContent>
              </Popover>

                {chatSending && prompt.trim() ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button type="submit" variant="ghost" size="icon-sm" className="rounded-full" aria-label={copy.queueFollowup}>
                        <Send />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{copy.queueFollowup}</TooltipContent>
                  </Tooltip>
                ) : null}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type={chatSending ? "button" : "submit"}
                      size="icon-lg"
                      variant={chatSending ? "secondary" : "default"}
                      className={cn(
                        "ml-auto rounded-full",
                        chatSending && "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
                      )}
                      disabled={chatSending ? false : !prompt.trim() || blockedWorkspace}
                      aria-label={chatSending ? copy.stopChatResponse : copy.sendChatMessage}
                      onClick={chatSending ? stopActiveChat : undefined}
                    >
                      {chatSending ? <Square className="size-4 fill-current" /> : <Send />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{chatSending ? copy.stopChatResponse : copy.sendChatMessage}</TooltipContent>
                </Tooltip>
              </div>
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

      <ContextPackPreviewDialog
        pack={packPreview}
        loading={packPreviewLoading}
        error={packPreviewError}
        open={packPreviewOpen}
        onOpenChange={setPackPreviewOpen}
        locale={locale}
        copy={copy}
        navigate={navigate}
      />

      <RecipeCatalogDialog
        open={recipeCatalogOpen}
        recipes={RECIPE_CATALOG}
        agents={agents}
        defaultAgentId={agent.id}
        runtime={runtime}
        workspaces={workspaces}
        onOpenChange={setRecipeCatalogOpen}
        onLaunch={launchRecipe}
        copy={copy}
      />

      <RecipeLaunchDialog
        open={Boolean(recipeLaunchTarget)}
        recipe={recipeLaunchTarget}
        agents={agents}
        defaultAgentId={agent.id}
        runtime={runtime}
        workspaces={workspaces}
        onOpenChange={(next) => { if (!next) setRecipeLaunchTarget(null); }}
        onLaunch={launchRecipe}
        copy={copy}
      />
    </div>
  );
}

// Goal 09: compact recommendation strip above the composer. Surfaces the top
// recipes matched from the user's request with the matched keywords as the
// reason; selecting one opens the launch preview. Kept calm and borderless to
// match the Notion-like composer surface.
function RecipeRecommendationPanel({ recipes = [], copy = getLocaleCopy(DEFAULT_LOCALE), onSelect }) {
  const text = recipeCopy(copy);
  if (!recipes.length) return null;
  return (
    <div className="mx-auto mb-2 w-full max-w-3xl">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="size-3.5" aria-hidden="true" />
        {text.recommendedFromRequest}
      </div>
      <div className="flex flex-wrap gap-2">
        {recipes.map((recipe) => (
          <button
            key={recipe.id}
            type="button"
            onClick={() => onSelect?.(recipe)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            title={recipe.matchedKeywords?.length ? formatCopy(text.recommendedReason, { keywords: recipe.matchedKeywords.join(", ") }) : recipe.description}
          >
            <BookOpen className="size-3.5" aria-hidden="true" />
            {recipe.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// Goal 08: pre-launch preview wrapper. Reuses the inspect dialog body once the
// pack is generated; shows loading/error states while the server builds it.
function ContextPackPreviewDialog({ pack, loading, error, open, onOpenChange, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE), navigate }) {
  const text = copy.contextPack || {};
  if (pack && !loading && !error) {
    return (
      <ContextPackInspectDialog
        pack={pack}
        row={{ workspaceLink: pack.workspace ? missionControlPath() : "" }}
        open={open}
        onOpenChange={onOpenChange}
        locale={locale}
        copy={copy}
        navigate={navigate}
      />
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="context-pack-preview">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-4 text-[#5d7a4e]" aria-hidden="true" />
            {text.previewTitle || "Context pack preview"}
          </DialogTitle>
          <DialogDescription>{text.previewDescription || "Review the pack before launching."}</DialogDescription>
        </DialogHeader>
        <div className="py-2 text-sm text-[#666666]">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              {text.generating || "Generating context pack…"}
            </span>
          ) : error ? (
            <span className="text-destructive">{error}</span>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {copy.close || "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QueuedFollowups({ items = [], copy = getLocaleCopy(DEFAULT_LOCALE), onChange, onRemove }) {
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState("");
  const editingItem = items.find((item) => item.id === editingId);

  useEffect(() => {
    if (!editingId) return;
    if (!editingItem) {
      setEditingId("");
      setDraft("");
    }
  }, [editingId, editingItem]);

  function startEdit(item) {
    setEditingId(item.id);
    setDraft(item.prompt);
  }

  function cancelEdit() {
    setEditingId("");
    setDraft("");
  }

  function saveEdit() {
    const nextPrompt = draft.trim();
    if (!editingId) return;
    if (nextPrompt) {
      onChange?.(editingId, nextPrompt);
    } else {
      onRemove?.(editingId);
    }
    cancelEdit();
  }

  return (
    <div className="border-b bg-background/30" data-queued-followups>
      <div className="flex min-h-9 items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <LayoutList className="size-3.5 shrink-0" />
          <span className="truncate font-medium text-foreground/80">{copy.queuedFollowups}</span>
          <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">
            {items.length}
          </Badge>
        </div>
      </div>
      <div className="divide-y divide-border/70">
        {items.map((item, index) => {
          const editing = item.id === editingId;
          return (
            <div key={item.id} className="grid min-h-11 items-center gap-2 px-3 py-2 [grid-template-columns:auto_minmax(0,1fr)_auto]">
              <span className="flex size-6 items-center justify-center rounded-md text-muted-foreground">
                <LayoutList className="size-3.5" />
              </span>
              {editing ? (
                <Input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      saveEdit();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelEdit();
                    }
                  }}
                  className="h-8 border-0 bg-background/70 px-2 text-sm shadow-none focus-visible:ring-2"
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 truncate rounded-sm text-left text-sm text-foreground/88 outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
                  onClick={() => startEdit(item)}
                >
                  {item.prompt}
                </button>
              )}
              <div className="flex shrink-0 items-center gap-1">
                <Badge variant="outline" className="hidden h-5 rounded-md px-1.5 text-[10px] sm:inline-flex">
                  {index === 0 ? copy.nextQueuedFollowup : `#${index + 1}`}
                </Badge>
                {editing ? (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={copy.saveQueuedFollowup} onClick={saveEdit}>
                          <CheckCircle2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.saveQueuedFollowup}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={copy.cancelQueuedEdit} onClick={cancelEdit}>
                          <X />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.cancelQueuedEdit}</TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={copy.editQueuedFollowup} onClick={() => startEdit(item)}>
                          <PencilLine />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.editQueuedFollowup}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-xs" aria-label={copy.removeQueuedFollowup} onClick={() => onRemove?.(item.id)}>
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.removeQueuedFollowup}</TooltipContent>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MentionPicker({ items = [], loading = false, error = "", selectedIndex = 0, onSelect }) {
  return (
    <div className="absolute bottom-full left-0 z-40 mb-1 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-md border bg-popover shadow-xl shadow-black/25">
      <div className="flex max-h-52 flex-col overflow-y-auto p-1">
        {items.map((item, index) => {
          const Icon = item.type === "agent" ? UserRound : item.type === "channel" ? Hash : FileCode2;
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
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    item.presence?.className || "bg-emerald-500",
                    item.presence?.pulse && "animate-pulse"
                  )}
                  aria-label={item.presence?.label || "Online"}
                />
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

function launchPermissionWarnings({ permissions, prompt, mode, policy }) {
  const ladder = autonomyLadderLevelMeta(permissions.ladderLevel);
  const value = String(prompt || "").toLowerCase();
  const warnings = [];

  if (policy === "yes" || permissions.permissionMode === "unrestricted") {
    warnings.push({
      id: "yes-policy",
      title: "Approval boundary",
      detail: "This launch can auto-approve broad tool use. Switch back to an ask-first policy unless this member has an explicit saved automation policy.",
    });
  }
  if (mode === "auto" && ladder.rank < 4) {
    warnings.push({
      id: "auto-low-level",
      title: "Auto run above ladder",
      detail: `Auto mode can attempt multi-step work, but ${ladder.label} keeps write surfaces blocked or approval-gated.`,
    });
  }
  if (/\b(rm\s+-rf|sudo|mkfs|chmod\s+777|git\s+reset\s+--hard)\b/.test(value)) {
    const meta = permissionLevelMeta(permissions.modes["shell.destructive"]);
    warnings.push({
      id: "destructive-command",
      title: "Destructive command blocked",
      detail: `shell.destructive is ${meta.label.toLowerCase()} at Level ${ladder.rank}. The run will not execute this without the configured gate.`,
    });
  }
  if (/\b(open|create|draft)\s+(a\s+)?(pr|pull request)|git\s+push|github\b/.test(value)) {
    const meta = permissionLevelMeta(permissions.modes["github.remote"]);
    warnings.push({
      id: "pr-command",
      title: "PR action gated",
      detail: PR_READY_LADDER_LEVELS.has(ladder.id)
        ? `GitHub remote work is ${meta.label.toLowerCase()} and requires connector readiness.`
        : `Raise the ladder to Open PR before GitHub remote work can request approval.`,
    });
  }
  if (/\b(auto-?merge|merge\s+(the\s+)?pr|git\s+merge)\b/.test(value)) {
    warnings.push({
      id: "merge-command",
      title: "Auto-merge disabled",
      detail: "Merge authority remains with the user at every ladder level.",
    });
  }

  return warnings.slice(0, 3);
}

function LaunchPermissionWarnings({ warnings = [] }) {
  if (!warnings.length) return null;
  return (
    <Alert className="m-2 mb-0 rounded-md border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-200">
      <ShieldAlert />
      <AlertTitle>{warnings[0].title}</AlertTitle>
      <AlertDescription>
        <div className="grid gap-1.5">
          {warnings.map((warning) => (
            <p key={warning.id}>{warning.detail}</p>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
}

function SquadStatusRow({ agent, activeMode, latestRun, runtime, workspace, workspaces, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const latestStatus = latestRun?.status || "idle";
  return (
    <div className="flex flex-col gap-2">
      <p className="max-w-3xl text-base leading-7 text-foreground/88">
        {localizedAgentInstructions(agent, copy)}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{runModeLabel(activeMode.id, copy)}</span>
        <span className="h-1 w-1 rounded-full bg-muted-foreground/45" />
        <span>{statusLabel(latestStatus, copy)}</span>
        <span className="h-1 w-1 rounded-full bg-muted-foreground/45" />
        <span className="min-w-0 truncate">{workspaceLabel(workspace, workspaces)}</span>
      </div>
      {!runtime?.available ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{copy.autohandCliMissing}</AlertTitle>
          <AlertDescription>{copy.autohandCliMissingDescription}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function SquadMessage({ agent, message, copy = getLocaleCopy(DEFAULT_LOCALE), chatSettings = DEFAULT_CHAT_SETTINGS }) {
  const isUser = message.role === "user";
  if (!isUser) return <AgentResponseMessage agent={agent} message={message} chatSettings={chatSettings} />;

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

function AgentResponseMessage({ agent, message, chatSettings = DEFAULT_CHAT_SETTINGS }) {
  const normalizedChatSettings = normalizeChatSettings(chatSettings);
  const view = buildAgentResponseView(message);
  const isThinkingPlaceholder = String(message.body || "").trim() === `${agent.name} is thinking...`;
  const isLoading = message.status === "loading" || isThinkingPlaceholder;
  const hasTrace = view.orderedEvents.length;
  const hasRawOutput = Boolean(view.raw.stdout || view.raw.stderr);
  const elapsedMs = useElapsedMs(message.startedAt, isLoading);
  const durationMs = isLoading ? elapsedMs : durationFromMessage(message);
  const durationLabel = durationMs === null ? "" : formatDuration(durationMs);
  const hasVisibleAnswer = Boolean(view.answer && !isThinkingPlaceholder);
  const showRawOutput = normalizedChatSettings.displayCliOutput && hasRawOutput;
  const showProgressPlaceholder = isLoading && !hasVisibleAnswer;
  const statusLabel = isLoading ? "Answering" : message.status === "error" ? "Could not answer" : message.status === "stopped" ? "Stopped" : "Answer";
  const progressLabel = chatProgressLabel(message, durationMs);

  return (
    <article className="grid grid-cols-[auto,minmax(0,1fr)] gap-3">
      <AgentAvatar agent={agent} />
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{agent.name}</span>
          <time>{message.time}</time>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/45" />
          <span>{statusLabel}</span>
          {durationLabel ? (
            <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">
              {isLoading ? `${durationLabel} elapsed` : durationLabel}
            </Badge>
          ) : null}
          {message.effectiveModel ? (
            <Badge variant="outline" className="h-5 max-w-72 rounded-md px-1.5 text-[10px]">
              <span className="truncate">{providerSummaryLabel(message.effectiveModel)}</span>
            </Badge>
          ) : null}
          {view.toolCalls.length ? (
            <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[10px]">
              {view.toolCalls.length} tools
            </Badge>
          ) : null}
        </div>

        {showProgressPlaceholder ? (
          <div className="flex max-w-xl items-center gap-3 py-2 text-sm text-muted-foreground">
            <Spinner />
            <span>{progressLabel}</span>
          </div>
        ) : null}

        {hasVisibleAnswer ? (
          <div className="max-w-4xl">
            <MarkdownBlocks text={view.answer} />
          </div>
        ) : null}

        {hasTrace ? <AgentWorkTrace view={view} open={isLoading} /> : null}

        {!isLoading && showRawOutput ? <RawTraceBlock raw={view.raw} /> : null}
      </div>
    </article>
  );
}

function chatProgressLabel(message, durationMs) {
  const activity = String(message?.activityLabel || "").trim();
  const model = message?.effectiveModel ? providerSummaryLabel(message.effectiveModel) : "";
  if (Number(durationMs) >= 45000) {
    return model
      ? `Still waiting for ${model}. The provider has not sent the first response yet.`
      : "Still waiting for the provider. No first response has arrived yet.";
  }
  return activity || "Waiting for the first response...";
}

function AgentWorkTrace({ view, open = false }) {
  return (
    <details open={open || undefined} className="mt-4 max-w-4xl border-l border-border/70 pl-4">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        Work details
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {view.orderedEvents.map((event, index) => (
          <WorkTraceEvent key={`${event.type}-${index}-${event.title || event.content || event.call?.name || ""}`} event={event} index={index} />
        ))}
      </div>
    </details>
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

  if (event.type === "status") {
    return <StatusTrace event={event} />;
  }

  if (event.type === "error") {
    return <StatusTrace event={event} tone="error" />;
  }

  return null;
}

function StatusTrace({ event, tone = "neutral" }) {
  return (
    <div className={cn("flex items-center gap-2 py-1.5 text-xs", tone === "error" ? "text-destructive" : "text-muted-foreground")}>
      <Activity className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{event.title || statusEventTitle(event.status)}</span>
      {event.timestamp ? <time className="ml-auto shrink-0 text-[11px]">{formatShortTime(event.timestamp)}</time> : null}
    </div>
  );
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
    <details className="mt-4 max-w-4xl rounded-md border bg-background/50">
      <summary className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-normal text-muted-foreground">
        Diagnostic output
      </summary>
      <div className="flex flex-col gap-3 border-t p-3">
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

const EMPTY_MISSION_COUNTS = Object.freeze({
  tasks: 0,
  memoryPending: 0,
  permissionWarnings: 0,
});

const MISSION_STATE_MATRIX = [
  {
    status: "running",
    treatment: "Active run in progress; keep watching output or continue the run.",
    evidence: "Latest command or run log.",
  },
  {
    status: "blocked",
    treatment: "Owner needs a decision, credential, dependency, or handoff.",
    evidence: "Failure reason or unresolved dependency.",
  },
  {
    status: "failed",
    treatment: "Run or checkpoint did not complete; replay from the recorded context.",
    evidence: "Failed checkpoint, test result, or runtime error.",
  },
  {
    status: "completed",
    treatment: "Recent work is preserved for review before it moves to archive.",
    evidence: "Review note, screenshot, or validation summary.",
  },
];

const TASK_EVIDENCE_EVENT_TYPES = [
  { id: "context-pack", label: "Context pack", icon: Boxes },
  { id: "prompt", label: "Prompt", icon: MessageSquareText },
  { id: "plan", label: "Plan", icon: LayoutList },
  { id: "command", label: "Command", icon: TerminalSquare },
  { id: "file-read", label: "File read", icon: FileCode2 },
  { id: "file-edit", label: "File edit", icon: PencilLine },
  { id: "test", label: "Test", icon: ClipboardCheck },
  { id: "screenshot", label: "Screenshot", icon: Monitor },
  { id: "handoff", label: "Handoff", icon: Workflow },
  { id: "approval", label: "Approval", icon: BadgeCheck },
  { id: "final", label: "Final", icon: CheckCircle2 },
  { id: "risk", label: "Risk", icon: AlertTriangle },
  { id: "evaluation", label: "Evaluation", icon: ShieldCheck },
];

// Goal 07: Evaluation Hooks — trust check metadata. Check ids map to localized
// names; states map to a tone + icon. Kept source-backed and explainable: each
// rendered check shows its decision logic, confidence, reason, and evidence.
const EVALUATION_CHECK_META = {
  citations: { labelKey: "evaluationCheckCitations" },
  verification: { labelKey: "evaluationCheckVerification" },
  scope: { labelKey: "evaluationCheckScope" },
  "user-evidence": { labelKey: "evaluationCheckUserEvidence" },
  "unsupported-claims": { labelKey: "evaluationCheckUnsupported" },
};

const EVALUATION_STATE_META = {
  pass: { labelKey: "evaluationStatePass", icon: CheckCircle2, dot: "bg-[#5d9f63]", text: "text-[#3d6a3f]" },
  fail: { labelKey: "evaluationStateFail", icon: AlertTriangle, dot: "bg-[#c0392b]", text: "text-[#a3271a]" },
  skip: { labelKey: "evaluationStateSkip", icon: CircleSlash, dot: "bg-[#c47a00]", text: "text-[#8a4b00]" },
  unknown: { labelKey: "evaluationStateUnknown", icon: CircleDot, dot: "bg-[#8a8a8a]", text: "text-[#666666]" },
};

const EVALUATION_CONFIDENCE_KEYS = {
  high: "evaluationConfidenceHigh",
  medium: "evaluationConfidenceMedium",
  low: "evaluationConfidenceLow",
};

function evaluationCheckLabel(id, copy) {
  const key = EVALUATION_CHECK_META[id]?.labelKey;
  return (key && copy?.[key]) || id;
}

function evaluationStateMeta(state) {
  return EVALUATION_STATE_META[state] || EVALUATION_STATE_META.unknown;
}

// Normalize a recorded evaluation (server-produced or seed fixture) into a
// stable shape the UI can render. Never invents pass/fail; missing data stays
// "unknown" with a reason.
function normalizeEvaluation(value) {
  if (!value || typeof value !== "object") return null;
  const checks = (Array.isArray(value.checks) ? value.checks : [])
    .map((check, index) => {
      if (!check || typeof check !== "object") return null;
      const state = ["pass", "fail", "skip", "unknown"].includes(check.state) ? check.state : "unknown";
      const evidence = (Array.isArray(check.evidence) ? check.evidence : [])
        .map((item) => {
          if (typeof item === "string") return { source: "ref", label: item, detail: "" };
          if (!item || typeof item !== "object") return null;
          return {
            source: String(item.source || "ref"),
            label: String(item.label || item.path || item.line || ""),
            detail: String(item.detail || item.at || ""),
          };
        })
        .filter((item) => item?.label);
      return {
        id: String(check.id || `check-${index}`),
        state,
        decision: check.decision === "model" ? "model" : "deterministic",
        confidence: ["high", "medium", "low"].includes(check.confidence) ? check.confidence : "low",
        reason: String(check.reason || ""),
        evidence,
      };
    })
    .filter(Boolean);
  if (!checks.length) return null;
  const passed = Number.isFinite(value.passed) ? value.passed : checks.filter((c) => c.state === "pass").length;
  const failed = Number.isFinite(value.failed) ? value.failed : checks.filter((c) => c.state === "fail").length;
  const total = Number.isFinite(value.total) ? value.total : checks.length;
  const summaryState =
    value.summaryState && ["all-pass", "some-fail", "incomplete"].includes(value.summaryState)
      ? value.summaryState
      : failed
        ? "some-fail"
        : passed === total
          ? "all-pass"
          : "incomplete";
  return {
    evaluatedAt: String(value.evaluatedAt || ""),
    evaluatorNote: String(value.evaluatorNote || ""),
    summaryState,
    passed,
    failed,
    total,
    checks,
  };
}

// Resolve the evaluation for a mission row: prefer a recorded evaluation
// timeline event, then the live run's evaluation, then a task-level fixture.
function evaluationForRow(row = {}) {
  const fromEvent = (Array.isArray(row.task?.timeline) ? row.task.timeline : [])
    .map((event) => (normalizeEvidenceType(event.evidenceType) === "evaluation" ? event.evaluation || event : null))
    .find(Boolean);
  return normalizeEvaluation(fromEvent) || normalizeEvaluation(row.run?.evaluation) || normalizeEvaluation(row.task?.evaluation);
}

function evaluationFailedRiskMessages(evaluation, copy = getLocaleCopy(DEFAULT_LOCALE)) {
  if (!evaluation) return [];
  return evaluation.checks
    .filter((check) => check.state === "fail")
    .map((check) => formatCopy(copy.evaluationFailedAttached, { check: evaluationCheckLabel(check.id, copy) }));
}

const TASK_EVIDENCE_EVENT_META = new Map(TASK_EVIDENCE_EVENT_TYPES.map((item) => [item.id, item]));
const TASK_EVIDENCE_EVENT_TYPE_IDS = new Set(TASK_EVIDENCE_EVENT_TYPES.map((item) => item.id));
const TASK_RAW_EVENT_TYPES = new Set(["command", "test"]);

function normalizeEvidenceType(value) {
  const normalized = String(value || "").trim().toLowerCase().replaceAll("_", "-");
  if (!normalized) return "";
  if (TASK_EVIDENCE_EVENT_TYPE_IDS.has(normalized)) return normalized;
  if (normalized === "file" || normalized === "file-change" || normalized === "changed-file") return "file-edit";
  if (normalized === "file-reads" || normalized === "read") return "file-read";
  if (normalized === "tests" || normalized === "build") return "test";
  if (normalized === "final-result" || normalized === "summary") return "final";
  if (normalized === "unresolved-risk" || normalized === "blocker") return "risk";
  if (normalized === "contextpack" || normalized === "pack" || normalized === "context") return "context-pack";
  return "";
}

function taskEvidenceTypeFor(event = {}) {
  const explicit = normalizeEvidenceType(event.evidenceType || event.category || event.kind);
  if (explicit) return explicit;

  const type = String(event.type || "").toLowerCase();
  const text = [
    event.summary,
    event.content,
    event.command,
    event.sourceEvidence,
    Array.isArray(event.files) ? event.files.map((file) => (typeof file === "string" ? file : file?.path || "")).join(" ") : "",
  ].join(" ").toLowerCase();

  if (type.includes("context.pack") || type.includes("context-pack") || text.includes("context pack")) return "context-pack";
  if (type.includes("prompt") || type === "task.created") return "prompt";
  if (type.includes("plan")) return "plan";
  if (type.includes("command") || type.includes("run.")) return "command";
  if (type.includes("file.read")) return "file-read";
  if (type.includes("file") || type.includes("diff") || type.includes("edit")) return "file-edit";
  if (type.includes("test") || text.includes("test result") || text.includes("build") || text.includes("deploy")) return "test";
  if (type.includes("screenshot") || text.includes("screenshot")) return "screenshot";
  if (type.includes("handoff")) return "handoff";
  if (type.includes("approval") || text.includes("approval") || text.includes("review approved")) return "approval";
  if (type.includes("final")) return "final";
  if (type.includes("risk") || type.includes("failed") || type.includes("blocked") || text.includes("missing ") || text.includes("unresolved")) return "risk";
  return "command";
}

function evidenceEventLabel(type) {
  return TASK_EVIDENCE_EVENT_META.get(type)?.label || "Evidence";
}

function extractEvidenceFiles(text = "") {
  const matches = String(text || "").match(/(?:^|[\s(["'`])([~./\w@-]+\/[\w@./-]+\.(?:[cm]?[jt]sx?|vue|css|scss|md|json|mjs|cjs|rs|py|html|ya?ml|toml|png|jpe?g|webp|svg)|[\w@.-]+\.(?:[cm]?[jt]sx?|vue|css|scss|md|json|mjs|cjs|rs|py|html|ya?ml|toml|png|jpe?g|webp|svg))/gi);
  return (matches || [])
    .map((match) => match.replace(/^[\s(["'`]+/, "").replace(/[),.;:"'`]+$/, ""))
    .filter(Boolean);
}

function normalizeEvidenceFiles(files, text = "") {
  const records = [];
  const seen = new Set();
  const addFile = (file) => {
    const source = typeof file === "string" ? { path: file } : file && typeof file === "object" ? file : {};
    const path = String(source.path || source.file || source.href || "").trim();
    if (!path || seen.has(path)) return;
    seen.add(path);
    records.push({
      path,
      label: String(source.label || path.split("/").filter(Boolean).at(-1) || path),
      action: source.action || "",
    });
  };

  (Array.isArray(files) ? files : []).forEach(addFile);
  extractEvidenceFiles(text).forEach(addFile);
  return records;
}

function normalizeRawLogLines(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { source: "raw", line: item, at: "" };
      if (!item || typeof item !== "object") return null;
      return {
        source: String(item.source || "run"),
        line: String(item.line || item.message || item.output || ""),
        at: String(item.at || item.time || ""),
      };
    })
    .filter((item) => item?.line);
}

function rawLogLinesForEvent(event, run) {
  const eventLines = normalizeRawLogLines(event.rawOutput || event.rawLog || event.logs);
  if (eventLines.length) return eventLines;
  if (!run || (event.runId && run.id !== event.runId)) return [];
  return normalizeRawLogLines(run.logs);
}

function evidenceEventFromTimeline(event = {}, row = {}, index = 0) {
  const evidenceType = taskEvidenceTypeFor(event);
  const summary = String(event.summary || event.content || event.command || event.sourceEvidence || "").trim();
  const contentText = [summary, event.content, event.command, event.sourceEvidence].filter(Boolean).join("\n");
  const run = row.run;
  const rawLogs = rawLogLinesForEvent(event, run);

  return {
    ...event,
    id: String(event.id || `${row.id || "row"}-${evidenceType}-${index}`),
    type: String(event.type || evidenceType),
    evidenceType,
    label: event.label || evidenceEventLabel(evidenceType),
    at: String(event.at || event.createdAt || event.updatedAt || row.updatedAt || new Date().toISOString()),
    summary: summary || evidenceEventLabel(evidenceType),
    command: String(event.command || (evidenceType === "command" || evidenceType === "test" ? run?.command || "" : "")),
    runId: String(event.runId || row.runtimeId || ""),
    logPath: String(event.logPath || run?.logPath || ""),
    files: normalizeEvidenceFiles(event.files || event.changedFiles || event.fileChanges, contentText),
    screenshotPath: String(event.screenshotPath || event.artifactPath || ""),
    rawLogs,
    confirmedEvidence: Array.isArray(event.confirmedEvidence) ? event.confirmedEvidence.map(String).filter(Boolean) : [],
    unresolvedRisks: Array.isArray(event.unresolvedRisks) ? event.unresolvedRisks.map(String).filter(Boolean) : [],
    evaluation: evidenceType === "evaluation" ? normalizeEvaluation(event.evaluation || event) : null,
    contextPack: evidenceType === "context-pack" ? event.contextPack || row.run?.contextPack || null : null,
  };
}

function evidenceTypeFromText(text = "") {
  const value = String(text || "").toLowerCase();
  if (value.includes("screenshot")) return "screenshot";
  if (value.includes("test") || value.includes("build") || value.includes("deploy")) return "test";
  if (value.includes("file") || value.includes("diff") || value.includes("touched")) return "file-edit";
  if (value.includes("approval") || value.includes("review")) return "approval";
  if (value.includes("run ") || value.includes("command")) return "command";
  return "command";
}

function collectRowRisks(row = {}) {
  const risks = [];
  if (row.blocker) risks.push(row.blocker);
  for (const warning of row.permissionWarnings || []) {
    if (warning?.message) risks.push(warning.message);
  }
  if (row.run && ["failed", "stopped"].includes(row.run.status)) {
    risks.push(`Run ${compactRecordId(row.run.id)} ended with status ${row.run.status}${row.run.exitCode !== null && row.run.exitCode !== undefined ? ` (${row.run.exitCode})` : ""}.`);
  }
  return Array.from(new Set(risks.filter(Boolean)));
}

// Goal 06: Layered Context Model — ordered, inspectable context layer contract.
const CONTEXT_LAYER_ORDER = [
  "systemContract",
  "teamOperatingRules",
  "agentRoleProfile",
  "projectMemory",
  "taskContextPack",
  "userRequest",
  "toolTranscript",
];

const CONTEXT_LAYER_STATIC = {
  systemContract:
    "Isolated CLI instance with explicit permission, file-guard, and model-security policies. Out-of-policy and destructive actions require escalation.",
  teamOperatingRules:
    "Preserve evidence, keep durable rules separate from task context, return blocking findings first, verify before claiming done. Auto-merge stays disabled.",
};

function truncateLayerSummary(value, max = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// Prefer the manifest the server recorded for the run. When a row has no live
// run (seed/demo data), synthesize the ordered manifest from the row's task,
// owner, and memory so every layer — included or absent — is still inspectable.
function contextLayerManifestForRow(row = {}) {
  const recorded = row.run?.contextLayers;
  if (recorded && Array.isArray(recorded.layers) && recorded.layers.length) {
    return recorded;
  }

  const owner = row.owner || null;
  const task = row.task || null;
  const mode = row.run?.mode || owner?.launch?.mode || "prompt";
  const memoryItems = Array.isArray(owner?.memory) ? owner.memory.filter(Boolean) : [];
  const brainCard = owner?.brainCard || null;
  const projects = Array.isArray(owner?.projects) ? owner.projects : [];
  const requestText = row.run?.title || task?.title || row.title || "";
  const layers = [];

  layers.push({
    name: "systemContract",
    included: true,
    source: "app:system-contract",
    sourceKey: null,
    sourceRef: "versioned-app",
    contentHash: "app:system-contract",
    summary: CONTEXT_LAYER_STATIC.systemContract,
  });
  layers.push({
    name: "teamOperatingRules",
    included: true,
    source: "app:team-operating-rules",
    sourceKey: null,
    sourceRef: "versioned-app",
    contentHash: "app:team-operating-rules",
    summary: CONTEXT_LAYER_STATIC.teamOperatingRules,
  });
  layers.push(
    owner
      ? {
          name: "agentRoleProfile",
          included: true,
          source: owner.id || "agent:role-profile",
          sourceKey: owner.id || null,
          sourceRef: "agent",
          summary: truncateLayerSummary(brainCard?.purpose || owner.role || "Agent role profile"),
        }
      : {
          name: "agentRoleProfile",
          included: false,
          sourceRef: "agent",
          reason: "Role profile not configured for this squad member.",
        }
  );
  layers.push(
    memoryItems.length
      ? {
          name: "projectMemory",
          included: true,
          source: "agent:memory",
          sourceKey: owner?.id || null,
          sourceRef: "memory",
          summary: truncateLayerSummary(`${memoryItems.length} saved memory item(s): ${memoryItems.slice(0, 3).join("; ")}`),
        }
      : {
          name: "projectMemory",
          included: false,
          sourceKey: owner?.id || null,
          sourceRef: "memory",
          reason: "No durable project memory configured.",
        }
  );
  layers.push(
    task || projects.length
      ? {
          name: "taskContextPack",
          included: true,
          source: task ? "task:context-pack" : "agent:projects",
          sourceKey: task?.id || null,
          sourceRef: "task",
          summary: truncateLayerSummary(
            task?.summary ||
              (projects.length ? `${projects.length} project path(s): ${projects.map((project) => project.label || project.name).slice(0, 3).join("; ")}` : "Task context pack")
          ),
        }
      : {
          name: "taskContextPack",
          included: false,
          sourceRef: "task",
          reason: "No task context pack or project paths attached.",
        }
  );
  layers.push(
    requestText
      ? {
          name: "userRequest",
          included: true,
          source: `run:${mode}`,
          sourceKey: null,
          sourceRef: "run",
          summary: truncateLayerSummary(requestText),
        }
      : {
          name: "userRequest",
          included: false,
          sourceRef: "run",
          reason: "No user request text in this run.",
        }
  );
  const hasTranscript = Boolean(row.run?.logs?.length) || Boolean(task?.timeline?.length);
  layers.push(
    hasTranscript
      ? {
          name: "toolTranscript",
          included: true,
          source: "run:transcript",
          sourceKey: null,
          sourceRef: "run",
          summary: truncateLayerSummary(
            row.run?.logs?.length
              ? `${row.run.logs.length} transcript line(s) recorded for this run.`
              : `${task.timeline.length} timeline event(s) recorded for this task.`
          ),
        }
      : {
          name: "toolTranscript",
          included: false,
          sourceRef: "run",
          reason: "Tool and result transcript is captured while the run executes.",
        }
  );

  return { mode, order: CONTEXT_LAYER_ORDER.slice(), layers, synthesized: true };
}

function taskEvidenceTimeline(row = {}) {
  const task = row.task;
  const run = row.run;
  const events = [];
  const seen = new Set();
  const addEvent = (event, fallbackIndex = events.length) => {
    const normalized = evidenceEventFromTimeline(event, row, fallbackIndex);
    const key = normalized.id || `${normalized.evidenceType}-${normalized.at}-${normalized.summary}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push(normalized);
  };

  if (task) {
    if (!Array.isArray(task.timeline) || !task.timeline.some((event) => normalizeEvidenceType(event.evidenceType) === "prompt" || event.type === "prompt.submitted")) {
      addEvent({
        id: `${task.id}-prompt`,
        type: "prompt.submitted",
        evidenceType: "prompt",
        at: task.createdAt || row.updatedAt,
        actorAgentId: task.originAgentId || task.agentId,
        targetAgentId: task.currentOwnerId || task.agentId,
        summary: task.title || "Task prompt recorded.",
      });
    }
    (Array.isArray(task.timeline) ? task.timeline : []).forEach(addEvent);

    for (const assignment of task.assignments || []) {
      if (!assignment?.sourceEvidence) continue;
      addEvent({
        id: `${assignment.id}-source-evidence`,
        type: "source.evidence",
        evidenceType: evidenceTypeFromText(assignment.sourceEvidence),
        at: assignment.updatedAt || assignment.createdAt,
        actorAgentId: assignment.agentId,
        targetAgentId: assignment.agentId,
        runId: assignment.runId || row.runtimeId,
        summary: assignment.sourceEvidence,
      });
    }

    for (const handoff of task.handoffs || []) {
      if (events.some((event) => event.handoffId === handoff.id)) continue;
      addEvent({
        id: `${handoff.id}-timeline`,
        type: `handoff.${handoff.status || "created"}`,
        evidenceType: handoff.status === "failed" ? "risk" : "handoff",
        at: handoff.updatedAt || handoff.createdAt,
        actorAgentId: handoff.fromAgentId,
        targetAgentId: handoff.toAgentId,
        handoffId: handoff.id,
        summary: handoff.failureReason || handoff.reason || "Handoff recorded.",
        files: normalizeEvidenceFiles([], handoff.sourceEvidence),
      });
    }
  } else if (run) {
    addEvent({
      id: `${run.id}-prompt`,
      type: "prompt.submitted",
      evidenceType: "prompt",
      at: run.startedAt,
      actorAgentId: run.agentId,
      targetAgentId: run.agentId,
      summary: run.title || "Standalone run prompt.",
    });
  }

  if (run && !events.some((event) => event.evidenceType === "command" && event.runId === run.id)) {
    addEvent({
      id: `${run.id}-command`,
      type: "command.started",
      evidenceType: "command",
      at: run.startedAt,
      actorAgentId: run.agentId,
      targetAgentId: run.agentId,
      runId: run.id,
      command: run.command,
      logPath: run.logPath,
      summary: run.command || "Run command captured.",
    });
  }

  // Goal 07: failed evaluation checks attach to the row's unresolved risk so a
  // low-trust result is visible alongside other blockers.
  const evaluation = evaluationForRow(row);
  const evaluationRisks = evaluationFailedRiskMessages(evaluation);
  const risks = Array.from(new Set([...collectRowRisks(row), ...evaluationRisks]));
  if (risks.length && !events.some((event) => event.evidenceType === "risk")) {
    addEvent({
      id: `${row.id || task?.id || run?.id}-risk`,
      type: "risk.open",
      evidenceType: "risk",
      at: row.updatedAt || run?.finishedAt || task?.updatedAt,
      actorAgentId: row.owner?.id || task?.currentOwnerId || run?.agentId,
      targetAgentId: row.owner?.id || task?.currentOwnerId || run?.agentId,
      summary: risks[0],
      unresolvedRisks: risks,
    });
  }

  if (["completed", "failed", "blocked", "stopped", "handoff-pending"].includes(row.status) && !events.some((event) => event.evidenceType === "final")) {
    const confirmed = events
      .filter((event) => !["risk", "final"].includes(event.evidenceType))
      .map((event) => event.summary)
      .filter(Boolean)
      .slice(-4);
    addEvent({
      id: `${row.id || task?.id || run?.id}-final`,
      type: "final.summary",
      evidenceType: "final",
      at: row.updatedAt || run?.finishedAt || task?.updatedAt,
      actorAgentId: row.owner?.id || task?.currentOwnerId || run?.agentId,
      targetAgentId: row.owner?.id || task?.currentOwnerId || run?.agentId,
      summary: row.status === "completed" ? "Task completed with recorded evidence." : "Current result recorded with remaining risk.",
      confirmedEvidence: confirmed,
      unresolvedRisks: risks,
    });
  }

  // Goal 07: a completed/finished run records its evaluation as a timeline event
  // so failed/skipped/unknown checks are visible on the task timeline.
  if (evaluation && !events.some((event) => event.evidenceType === "evaluation")) {
    addEvent({
      id: `${row.id || task?.id || run?.id}-evaluation`,
      type: "evaluation.recorded",
      evidenceType: "evaluation",
      at: evaluation.evaluatedAt || row.updatedAt || run?.finishedAt || task?.updatedAt,
      actorAgentId: row.owner?.id || task?.currentOwnerId || run?.agentId,
      targetAgentId: row.owner?.id || task?.currentOwnerId || run?.agentId,
      summary:
        evaluation.summaryState === "all-pass"
          ? "All trust checks passed."
          : evaluation.summaryState === "some-fail"
            ? "One or more trust checks failed."
            : "Trust evaluation completed with incomplete checks.",
      evaluation,
    });
  }

  // Goal 08: surface the generated context pack as the first timeline event so
  // the run transcript always names the pack the agent started from.
  if (run?.contextPack && !events.some((event) => event.evidenceType === "context-pack")) {
    addEvent({
      id: `${run.id}-context-pack`,
      type: "context.pack.generated",
      evidenceType: "context-pack",
      at: run.contextPack.generatedAt || run.startedAt,
      actorAgentId: run.agentId,
      targetAgentId: run.agentId,
      runId: run.id,
      workspace: run.workspace,
      summary: run.contextPack.summary || "Context pack generated before the run.",
      contextPack: run.contextPack,
    });
  }

  return events
    .map((event) => (event.evidenceType === "evaluation" && !event.evaluation && evaluation ? { ...event, evaluation } : event))
    .sort((left, right) => missionTime(left.at) - missionTime(right.at));
}

// Goal 07: classify a mission row by its recorded evaluation state so Mission
// Control can filter by trust outcome. "none" means no evaluation was recorded.
function missionRowEvaluationState(row = {}) {
  const evaluation = evaluationForRow(row);
  if (!evaluation) return "none";
  return evaluation.summaryState;
}

const MISSION_EVALUATION_FILTERS = [
  { id: "all-pass", labelKey: "evaluationFilterAllPass" },
  { id: "some-fail", labelKey: "evaluationFilterSomeFail" },
  { id: "incomplete", labelKey: "evaluationFilterIncomplete" },
  { id: "none", labelKey: "evaluationFilterNone" },
];

function timelineFileLink(row, filePath) {
  const base = row?.workspaceLink || row?.detailPath || missionControlPath();
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}file=${encodeURIComponent(filePath)}`;
}

function MissionControlPage({
  agents = [],
  tasks = [],
  runs = [],
  runtime,
  workspaces = [],
  route,
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  navigate,
  runsError = "",
  workspacesError = "",
  counts = EMPTY_MISSION_COUNTS,
  onLaunchRecipe,
  activeAgentId,
}) {
  const params = new URLSearchParams(route.split("?")[1] || "");
  const recipeText = recipeCopy(copy);
  const [recipeCatalogOpen, setRecipeCatalogOpen] = useState(false);
  const allRows = useMemo(
    () => buildMissionRows({ agents, tasks, runs, runtime, workspaces }),
    [agents, runs, runtime, tasks, workspaces]
  );
  const evaluationState = params.get("eval") || "";
  const rowEvaluationStates = useMemo(
    () => new Map(allRows.map((row) => [row.id, missionRowEvaluationState(row)])),
    [allRows]
  );
  const evaluationFilterCounts = useMemo(() => {
    const counts = {};
    for (const state of rowEvaluationStates.values()) counts[state] = (counts[state] || 0) + 1;
    return counts;
  }, [rowEvaluationStates]);
  const rows = useMemo(
    () => (evaluationState ? allRows.filter((row) => rowEvaluationStates.get(row.id) === evaluationState) : allRows),
    [allRows, evaluationState, rowEvaluationStates]
  );
  const setEvaluationFilter = (next) => {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set("eval", next);
    else nextParams.delete("eval");
    const query = nextParams.toString();
    navigate?.(`${missionControlPath()}${query ? `?${query}` : ""}`);
  };
  const selectedTaskId = params.get("task");
  const selectedRunId = params.get("run");
  const selectedRow =
    rows.find((row) => (selectedTaskId && row.task?.id === selectedTaskId) || (selectedRunId && row.runtimeId === selectedRunId)) ||
    rows[0] ||
    null;
  const activeRows = rows.filter((row) => !["completed", "cancelled"].includes(row.status));
  const blockedRows = rows.filter((row) => ["blocked", "failed"].includes(row.status) || row.blocker);
  const completedRows = rows.filter((row) => row.status === "completed");
  const loadState = missionControlLoadState({ runtime, rows, runsError, workspacesError });
  const runningRows = rows.filter((row) => ["running", "launching", "handoff-pending"].includes(row.status));

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#fafafa] text-[#2f2f2f] dark:bg-[#fafafa] dark:text-[#2f2f2f]">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-10 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <header className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(460px,0.46fr)] xl:items-end">
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium uppercase text-[#666666]">
              <span className="inline-flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-[#3f7f43]" aria-hidden="true" />
                Live Squad Operations
              </span>
              <span className={blockedRows.length ? "text-[#8a4b00]" : "text-[#3d6a3f]"}>
                {formatLocalizedNumber(blockedRows.length, locale)} Risks
              </span>
            </div>
            <h1 className="max-w-5xl text-balance text-[2.75rem] font-semibold leading-[0.98] tracking-normal text-[#191815] sm:text-6xl lg:text-[5.5rem]">
              Mission Control
            </h1>
            <p className="mt-5 max-w-3xl text-pretty text-base leading-7 text-[#555555] sm:text-lg">
              Every squad member, current task, repository, run state, blocker, last evidence, and next action in one operating view.
            </p>
            {onLaunchRecipe ? (
              <button
                type="button"
                onClick={() => setRecipeCatalogOpen(true)}
                className="mt-6 inline-flex h-9 items-center gap-2 rounded-md border border-[#cfcfcf] bg-white px-3.5 text-sm font-medium text-[#2f2f2f] transition-colors hover:border-[#9bbf90] hover:bg-[#f3f8f1] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60"
                data-testid="mission-launch-recipe"
              >
                <BookOpen className="size-4" aria-hidden="true" />
                {recipeText.launchRecipe}
              </button>
            ) : null}
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-y-6 border-y border-[#dedede] py-5 sm:grid-cols-4 xl:grid-cols-2">
            <MissionMetric label="Active Work" value={formatLocalizedNumber(activeRows.length, locale)} />
            <MissionMetric label="Running" value={formatLocalizedNumber(runningRows.length, locale)} tone="live" />
            <MissionMetric label="Memory Pending" value={formatLocalizedNumber(counts.memoryPending, locale)} />
            <MissionMetric label="Permission Warnings" value={formatLocalizedNumber(counts.permissionWarnings, locale)} tone={counts.permissionWarnings ? "risk" : "quiet"} />
          </div>
        </header>

        <MissionControlStateNotice
          state={loadState}
          runsError={runsError}
          workspacesError={workspacesError}
          runtime={runtime}
        />

        <MissionPermissionWarnings agents={agents} runtime={runtime} workspaces={workspaces} navigate={navigate} />

        {loadState === "loading" ? <MissionControlSkeleton /> : null}

        <MissionMemberLanes
          agents={agents}
          rows={rows}
          runtime={runtime}
          workspaces={workspaces}
          locale={locale}
          copy={copy}
          navigate={navigate}
        />

        <MissionEvaluationFilter
          active={evaluationState}
          counts={evaluationFilterCounts}
          onChange={setEvaluationFilter}
          copy={copy}
          locale={locale}
        />

        {rows.length ? (
          <MissionControlTable
            rows={rows}
            evaluationStates={rowEvaluationStates}
            locale={locale}
            copy={copy}
            navigate={navigate}
            selectedRow={selectedRow}
          />
        ) : loadState !== "loading" ? (
          <EmptyBlock icon={Monitor} title="No squad work yet" body="Start a squad member run and Mission Control will track the active and recent records here." />
        ) : null}

        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_380px]">
          <MissionDetailPanel row={selectedRow} locale={locale} copy={copy} navigate={navigate} />
          <MissionStateMatrix />
        </div>
      </div>

      {onLaunchRecipe ? (
        <RecipeCatalogDialog
          open={recipeCatalogOpen}
          recipes={RECIPE_CATALOG}
          agents={agents}
          defaultAgentId={activeAgentId}
          runtime={runtime}
          workspaces={workspaces}
          onOpenChange={setRecipeCatalogOpen}
          onLaunch={onLaunchRecipe}
          copy={copy}
        />
      ) : null}
    </div>
  );
}

function formatRelativeTime(value, locale = DEFAULT_LOCALE) {
  if (!value) return "";
  const date = new Date(value);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function squadStatusMeta(status) {
  switch (status) {
    case "running":
    case "launching":
      return { label: "Working", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", live: true };
    case "handoff-pending":
      return { label: "Handoff", dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" };
    case "pending":
      return { label: "Pending", dot: "bg-sky-500", text: "text-sky-600 dark:text-sky-400" };
    case "blocked":
      return { label: "Blocked", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-500" };
    case "failed":
      return { label: "Failed", dot: "bg-red-500", text: "text-red-600 dark:text-red-400" };
    case "completed":
      return { label: "Done", dot: "bg-emerald-500", text: "text-muted-foreground" };
    case "available":
    case "online":
    case "ready":
    case "idle":
      return { label: "Available", dot: "bg-emerald-500", text: "text-muted-foreground" };
    case "away":
      return { label: "Away", dot: "bg-amber-400", text: "text-muted-foreground" };
    case "offline":
    case "archived":
    case "disabled":
      return { label: "Offline", dot: "bg-muted-foreground/40", text: "text-muted-foreground/70" };
    default:
      return { label: status ? status.replace(/-/g, " ") : "Idle", dot: "bg-muted-foreground/40", text: "text-muted-foreground" };
  }
}

// Availability is the user-managed lifecycle state of a member, kept distinct
// from the work/activity surfaced in Mission Control. The Squad page owns this.
const SQUAD_MEMBER_STATES = [
  {
    id: "active",
    label: "Active",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    desc: "Online and available to pick up new work.",
  },
  {
    id: "away",
    label: "Away",
    dot: "bg-amber-400",
    text: "text-amber-600 dark:text-amber-500",
    desc: "Online, but not taking on new tasks right now.",
  },
  {
    id: "paused",
    label: "Paused",
    dot: "bg-slate-400",
    text: "text-slate-600 dark:text-slate-300",
    desc: "Suspended. In-flight work holds until you resume.",
  },
  {
    id: "offline",
    label: "Offline",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground/70",
    desc: "Not running. Won't respond until brought back online.",
  },
];

function memberStateId(agent) {
  const status = String(agent?.status || "").toLowerCase();
  if (["paused", "suspended", "hold"].includes(status)) return "paused";
  if (["away", "busy", "dnd"].includes(status)) return "away";
  if (OFFLINE_MEMBER_STATUSES.has(status)) return "offline";
  return "active";
}

function memberStateMeta(id) {
  return SQUAD_MEMBER_STATES.find((state) => state.id === id) || SQUAD_MEMBER_STATES[0];
}

function squadMemberState(agent, agentRows = []) {
  const runningRow = agentRows.find((row) => ["running", "launching"].includes(row.status));
  const currentRow = agentRows.find((row) => !["completed", "cancelled"].includes(row.status)) || null;
  const stateId = memberStateId(agent);
  const working = Boolean(runningRow) && stateId !== "offline";
  const lastActive = agentRows[0]?.updatedAt || agent?.lastConversationAt || agent?.updatedAt || agent?.createdAt;
  return { stateId, meta: memberStateMeta(stateId), working, runningRow, currentRow, lastActive };
}

const SQUAD_FILTERS = [{ id: "all", label: "All" }, ...SQUAD_MEMBER_STATES.map((state) => ({ id: state.id, label: state.label }))];

function SquadDirectoryPage({
  agents = [],
  tasks = [],
  runs = [],
  runtime,
  workspaces = [],
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  navigate,
  counts = EMPTY_MISSION_COUNTS,
  onDeleteAgent,
  updateAgent,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [pendingDelete, setPendingDelete] = useState(null);

  function handleSetState(agentId, stateId) {
    updateAgent?.(agentId, { status: stateId, updatedAt: new Date().toISOString() });
  }

  const visibleAgents = useMemo(() => agents.filter((agent) => agent?.id && agent?.name), [agents]);
  const rows = useMemo(
    () => buildMissionRows({ agents: visibleAgents, tasks, runs, runtime, workspaces }),
    [visibleAgents, tasks, runs, runtime, workspaces]
  );
  const rowsByOwner = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const ownerId = row.owner?.id;
      if (!ownerId) continue;
      if (!map.has(ownerId)) map.set(ownerId, []);
      map.get(ownerId).push(row);
    }
    return map;
  }, [rows]);

  const members = useMemo(
    () =>
      visibleAgents.map((agent) => {
        const agentRows = rowsByOwner.get(agent.id) || [];
        return { agent, agentRows, state: squadMemberState(agent, agentRows) };
      }),
    [visibleAgents, rowsByOwner]
  );

  const stateCounts = SQUAD_MEMBER_STATES.map((state) => ({
    ...state,
    count: members.filter((member) => member.state.stateId === state.id).length,
  }));
  const workingNow = members.filter((member) => member.state.working).length;

  const normalizedQuery = query.trim().toLowerCase();
  const filteredMembers = members.filter(({ agent, state }) => {
    if (filter !== "all" && state.stateId !== filter) return false;
    if (!normalizedQuery) return true;
    const haystack = [
      agent.name,
      agent.role,
      localizedRole(agent, copy),
      agent.staffId,
      workspaceName(getAgentWorkspace(agent, runtime, workspaces)),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
        <header className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-2 animate-ping rounded-full bg-emerald-500/70" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                Live · Autohand Squad
              </div>
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Squad</h1>
              <p className="mt-3 max-w-2xl text-pretty text-base leading-7 text-muted-foreground">
                Manage your AI team — set each member's availability and see what they're working on. Live work and task
                detail live in Mission Control.
              </p>
            </div>
            <Button className="h-10 shrink-0 rounded-md" onClick={() => navigate(`${MEMBER_ROUTE_PREFIX}/new`)}>
              <Plus data-icon="inline-start" />
              {copy.createSquadMember || "New member"}
            </Button>
          </div>

          <SquadStateBar
            stateCounts={stateCounts}
            total={members.length}
            workingNow={workingNow}
            activeFilter={filter}
            onSelect={setFilter}
            navigate={navigate}
            locale={locale}
          />
        </header>

        <div className="sticky top-0 z-10 -mx-1 mt-6 flex flex-col gap-3 bg-background/85 px-1 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search members, roles, repos…"
              aria-label="Search squad members"
              className="h-10 pl-9"
            />
          </div>
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(value) => setFilter(value || "all")}
            variant="outline"
            className="w-fit"
            aria-label="Filter members by status"
          >
            {SQUAD_FILTERS.map((item) => (
              <ToggleGroupItem key={item.id} value={item.id} className="px-3 text-xs font-medium">
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {filteredMembers.length ? (
          <section aria-label="Squad members" className="mt-2">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_150px_minmax(0,2fr)_72px] items-center gap-4 border-b border-border/70 px-2 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
              <span>Member</span>
              <span>State</span>
              <span>Recent tasks</span>
              <span className="text-right">Manage</span>
            </div>
            <ul className="divide-y divide-border/60">
              {filteredMembers.map(({ agent, agentRows, state }) => (
                <SquadMemberRow
                  key={agent.id}
                  agent={agent}
                  agentRows={agentRows}
                  state={state}
                  runtime={runtime}
                  workspaces={workspaces}
                  locale={locale}
                  copy={copy}
                  navigate={navigate}
                  onSetState={handleSetState}
                  onRequestDelete={() => setPendingDelete(agent)}
                />
              ))}
            </ul>
          </section>
        ) : (
          <div className="mt-10">
            <EmptyBlock
              icon={Users}
              title={query || filter !== "all" ? "No members match" : "No squad members yet"}
              body={
                query || filter !== "all"
                  ? "Try a different search or clear the status filter."
                  : "Create your first squad member to start delegating local engineering work."
              }
            />
          </div>
        )}
      </div>

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => (open ? null : setPendingDelete(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {pendingDelete?.name || "member"}?</DialogTitle>
            <DialogDescription>
              This removes {pendingDelete?.name || "this member"} from your squad, along with their conversations and
              automations in this view. Task records stay in Mission Control history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onDeleteAgent?.(pendingDelete?.id);
                setPendingDelete(null);
              }}
            >
              <Trash2 data-icon="inline-start" />
              Remove member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SquadStateBar({ stateCounts = [], total = 0, workingNow = 0, activeFilter = "all", onSelect, navigate, locale = DEFAULT_LOCALE }) {
  const denominator = Math.max(total, 1);
  const segments = stateCounts.filter((state) => state.count > 0);

  return (
    <section className="border-y border-border/70 py-5" aria-label="Team state">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Team state</div>
          <div className="mt-1 text-sm text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{formatLocalizedNumber(total, locale)}</span> members
            {workingNow ? (
              <>
                {" · "}
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {formatLocalizedNumber(workingNow, locale)} working now
                </span>
              </>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate?.(missionControlPath())}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Live work in Mission Control
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {segments.length ? (
          segments.map((state) => (
            <span
              key={state.id}
              className={cn("h-full", state.dot)}
              style={{ width: `${(state.count / denominator) * 100}%` }}
              title={`${state.label}: ${state.count}`}
            />
          ))
        ) : (
          <span className="h-full w-full" />
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5">
        {stateCounts.map((state) => {
          const active = activeFilter === state.id;
          return (
            <button
              key={state.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect?.(active ? "all" : state.id)}
              className={cn(
                "group inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active && "bg-muted"
              )}
            >
              <span className={cn("size-2 rounded-full", state.dot)} aria-hidden="true" />
              <span className={cn("font-medium", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                {state.label}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatLocalizedNumber(state.count, locale)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MemberStateControl({ agent, stateId, working = false, onChange }) {
  const [open, setOpen] = useState(false);
  const meta = memberStateMeta(stateId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-transparent px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`Set state for ${agent?.name || "member"} — currently ${meta.label}`}
        >
          <span className={cn("size-1.5 rounded-full", meta.dot, working && "animate-pulse")} aria-hidden="true" />
          {meta.label}
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Set availability</div>
        {SQUAD_MEMBER_STATES.map((state) => {
          const selected = state.id === stateId;
          return (
            <button
              key={state.id}
              type="button"
              onClick={() => {
                onChange?.(state.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                selected && "bg-muted/60"
              )}
            >
              <span className={cn("mt-1 size-2 shrink-0 rounded-full", state.dot)} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  {state.label}
                  {selected ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : null}
                </span>
                <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{state.desc}</span>
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function SquadMemberRow({
  agent,
  agentRows = [],
  state,
  runtime,
  workspaces = [],
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  navigate,
  onSetState,
  onRequestDelete,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const recent = agentRows.slice(0, 3);
  const workspace = getAgentWorkspace(agent, runtime, workspaces);
  const role = localizedRole(agent, copy) || agent.role;
  const { meta, stateId, working } = state;
  const isResting = stateId === "paused" || stateId === "offline";

  function go(path) {
    setMenuOpen(false);
    navigate(path);
  }

  return (
    <li className="group grid grid-cols-1 items-start gap-4 px-2 py-4 transition-colors hover:bg-muted/40 lg:grid-cols-[minmax(0,1.5fr)_150px_minmax(0,2fr)_72px] lg:items-center">
      <button
        type="button"
        onClick={() => navigate(memberProfilePath(agent.id, "home"))}
        className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="relative inline-flex shrink-0">
          <AgentAvatar agent={agent} className="size-11" />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background",
              meta.dot,
              working && "animate-pulse"
            )}
            aria-hidden="true"
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{agent.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{role || copy.squadMember || "Squad member"}</span>
          {workspace ? (
            <span className="mt-0.5 hidden truncate text-[11px] text-muted-foreground/70 sm:block">
              {workspaceName(workspace) || workspace}
            </span>
          ) : null}
        </span>
      </button>

      <div className="min-w-0">
        <MemberStateControl
          agent={agent}
          stateId={stateId}
          working={working}
          onChange={(next) => onSetState?.(agent.id, next)}
        />
        <div className="mt-1.5 text-[11px] text-muted-foreground/70">
          {working ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">Working now</span>
          ) : state.lastActive ? (
            <>Active {formatRelativeTime(state.lastActive, locale)}</>
          ) : null}
        </div>
      </div>

      <div className="min-w-0">
        {recent.length ? (
          <ul className="flex flex-col gap-1.5">
            {recent.map((row) => {
              const rowMeta = squadStatusMeta(row.status);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => navigate(row.taskPath || row.detailPath)}
                    className="flex w-full min-w-0 items-center gap-2 rounded-sm py-0.5 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    title={row.title}
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", rowMeta.dot)} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{row.title}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                      {formatRelativeTime(row.updatedAt, locale)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <span className="text-sm text-muted-foreground/70">No recent tasks</span>
        )}
      </div>

      <div className="flex items-center gap-1 lg:justify-end">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              onClick={() => navigate(memberChatPath(agent.id))}
              aria-label={`Chat with ${agent.name}`}
            >
              <MessageSquareText className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open chat</TooltipContent>
        </Tooltip>

        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              aria-label={`Manage ${agent.name}`}
            >
              <Ellipsis className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1">
            <SquadMenuItem icon={MessageSquareText} onClick={() => go(memberChatPath(agent.id))}>
              Open chat
            </SquadMenuItem>
            <SquadMenuItem icon={CircleUserRound} onClick={() => go(memberProfilePath(agent.id, "home"))}>
              View profile
            </SquadMenuItem>
            <SquadMenuItem icon={Workflow} onClick={() => go(automationListPath(agent.id))}>
              Automations
            </SquadMenuItem>
            <Separator className="my-1" />
            {isResting ? (
              <SquadMenuItem
                icon={Play}
                onClick={() => {
                  setMenuOpen(false);
                  onSetState?.(agent.id, "active");
                }}
              >
                Set active
              </SquadMenuItem>
            ) : (
              <SquadMenuItem
                icon={PauseCircle}
                onClick={() => {
                  setMenuOpen(false);
                  onSetState?.(agent.id, "paused");
                }}
              >
                Pause member
              </SquadMenuItem>
            )}
            <Separator className="my-1" />
            <SquadMenuItem
              icon={Trash2}
              destructive
              onClick={() => {
                setMenuOpen(false);
                onRequestDelete?.();
              }}
            >
              Remove member
            </SquadMenuItem>
          </PopoverContent>
        </Popover>
      </div>
    </li>
  );
}

function SquadMenuItem({ icon: Icon, children, onClick, destructive = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted"
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

function MissionMetric({ label, value, tone = "neutral" }) {
  const toneClass = {
    live: "text-[#3f7f43]",
    risk: "text-[#8a4b00]",
    quiet: "text-[#4f4a43]",
    neutral: "text-[#191815]",
  }[tone] || "text-[#191815]";

  return (
    <div className="min-w-0 px-3 sm:px-4">
      <div className={cn("truncate font-mono text-3xl font-semibold leading-none tabular-nums", toneClass)}>{value}</div>
      <div className="mt-2 truncate text-xs font-medium uppercase text-[#858585]">{label}</div>
    </div>
  );
}

function MissionAnchor({ href, navigate, className, children, ...props }) {
  function onClick(event) {
    props.onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    navigate?.(href);
  }

  return (
    <a {...props} href={href} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

function MissionControlStateNotice({ state, runsError, workspacesError, runtime }) {
  if (state === "loading") {
    return (
      <div className="flex items-start gap-3 border-l-2 border-[#8fb885] pl-3 text-[#2f5131]" role="status">
        <Spinner className="mt-0.5 size-4" aria-hidden="true" />
        <div>
          <div className="text-sm font-semibold">Loading Mission Control signals</div>
          <div className="mt-1 text-sm text-[#557357]">Checking runtime, runs, workspaces, and local bridge state.</div>
        </div>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div className="flex items-start gap-3 border-l-2 border-[#d44d36] pl-3 text-[#9b3726]" role="alert">
        <AlertTriangle className="mt-0.5 size-4" aria-hidden="true" />
        <div>
          <div className="text-sm font-semibold">Mission Control data is incomplete</div>
          <div className="mt-1 text-sm">{runsError || workspacesError || "The local bridge returned an unexpected response."}</div>
        </div>
      </div>
    );
  }

  if (state === "no-runtime") {
    return (
      <div className="flex items-start gap-3 border-l-2 border-[#d44d36] pl-3 text-[#9b3726]" role="alert">
        <Unplug className="mt-0.5 size-4" aria-hidden="true" />
        <div>
          <div className="text-sm font-semibold">Local runtime is offline</div>
          <div className="mt-1 text-sm">
          Mission Control is showing durable task records, but live run output is unavailable until the local bridge is running.
          {runtime?.autohandPath ? ` Runtime path: ${runtime.autohandPath}` : ""}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function MissionPermissionWarnings({ agents = [], runtime, workspaces = [], navigate }) {
  const warningRows = agents.flatMap((agent) => {
    const workspace = getAgentWorkspace(agent, runtime, workspaces);
    return permissionWarningsForAgent(agent, runtime, workspace).map((warning) => ({
      agent,
      workspace,
      warning,
      ladder: autonomyLadderLevelMeta(resolveAgentPermissionsForWorkspace(agent, workspace).ladderLevel),
    }));
  });

  if (!warningRows.length) return null;

  return (
    <section className="border-y border-[#dedede] py-5" aria-labelledby="mission-permission-warnings">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="mission-permission-warnings" className="text-xl font-semibold text-[#191815]">Permission Warnings</h2>
          <p className="mt-1 text-sm text-[#666666]">Autonomy, guard, and connector checks before risky work starts.</p>
        </div>
        <span className="text-xs font-medium uppercase text-[#8a4b00]">{warningRows.length} Warnings</span>
      </div>
      <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-3">
        {warningRows.slice(0, 6).map(({ agent, workspace, warning, ladder }) => (
          <MissionAnchor
            key={`${agent.id}-${workspace}-${warning.id}`}
            href={memberProfilePath(agent.id, "permissions")}
            navigate={navigate}
            className="grid gap-3 border-t border-[#e4e4e4] py-4 text-left transition-[background-color] hover:bg-[#f2f2f2] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60 md:border-r md:px-4"
          >
            <span className="flex min-w-0 items-center gap-3">
              <AgentAvatar agent={agent} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-[#191815]">{agent.name}</span>
                <span className="block truncate text-xs text-[#666666]">
                  Level {ladder.rank}: {ladder.label} / {workspaceName(workspace) || "workspace"}
                </span>
              </span>
            </span>
            <span className="border-l-2 border-[#c47a00] pl-3 text-xs leading-5 text-[#855800]">{warning.message}</span>
          </MissionAnchor>
        ))}
      </div>
    </section>
  );
}

function MissionControlSkeleton() {
  return (
    <div className="grid gap-0 border-y border-[#dedede] md:grid-cols-2 xl:grid-cols-4" aria-label="Loading Mission Control dashboard">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="grid gap-3 border-b border-[#e8e8e8] py-5 md:border-r md:px-4">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function MissionMemberLanes({ agents = [], rows = [], runtime, workspaces = [], locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE), navigate }) {
  if (!agents.length) return null;

  return (
    <section aria-labelledby="mission-squad-lanes">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="mission-squad-lanes" className="text-xl font-semibold text-[#191815]">Squad Board</h2>
          <p className="mt-1 text-sm text-[#666666]">Current ownership across the team.</p>
        </div>
        <span className="text-xs font-medium uppercase text-[#858585]">
          {formatLocalizedNumber(agents.length, locale)} Members
        </span>
      </div>
      <div className="grid border-y border-[#dedede] md:grid-cols-2 xl:grid-cols-4">
        {agents.map((agent) => {
          const currentRow = missionCurrentRowForAgent(agent, rows);
          const workspace = getAgentWorkspace(agent, runtime, workspaces);
          const permissions = resolveAgentPermissionsForWorkspace(agent, workspace);
          const ladder = autonomyLadderLevelMeta(permissions.ladderLevel);
          const warnings = permissionWarningsForAgent(agent, runtime, workspace);
          return (
            <MissionAnchor
              key={agent.id}
              href={memberProfilePath(agent.id, "home")}
              navigate={navigate}
              className="group grid min-h-36 gap-4 border-b border-[#e8e8e8] px-1 py-5 text-left transition-[background-color,color] hover:bg-[#f2f2f2] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60 md:border-r md:px-4 xl:last:border-r-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <AgentAvatar agent={agent} />
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-[#191815]">{agent.name}</span>
                  <span className="block truncate text-xs text-[#666666]">{localizedRole(agent, copy)}</span>
                </span>
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <MissionStatusPill status={currentRow?.status || agent.status || "idle"} copy={copy} />
                  <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium", warnings.length ? "bg-[#fff2df] text-[#8a4b00]" : "bg-[#eeeeee] text-[#555555]")}>
                    <ShieldAlert className="size-3.5" aria-hidden="true" />
                    L{ladder.rank}
                  </span>
                  {currentRow?.runtimeId ? (
                    <span className="max-w-[8rem] truncate font-mono text-[10px] text-[#858585]">
                      {compactRecordId(currentRow.runtimeId)}
                    </span>
                  ) : null}
                </div>
                <div className="min-h-10 text-pretty text-sm font-medium leading-5 text-[#2f2f2f]">
                  {currentRow?.title || "Available for a new task"}
                </div>
                <div className="mt-3 truncate text-xs text-[#858585]">{workspaceName(workspace) || workspace || "No workspace selected"}</div>
              </div>
            </MissionAnchor>
          );
        })}
      </div>
    </section>
  );
}

// Goal 07: filter Mission Control rows by recorded evaluation state. Calm,
// borderless chip row consistent with the surrounding neutral surface.
function MissionEvaluationFilter({ active = "", counts = {}, onChange, copy = getLocaleCopy(DEFAULT_LOCALE), locale = DEFAULT_LOCALE }) {
  const available = MISSION_EVALUATION_FILTERS.filter((filter) => counts[filter.id]);
  if (!available.length) return null;

  return (
    <section aria-label={copy.evaluationFilterHeading} className="flex flex-wrap items-center gap-2 border-y border-[#dedede] py-3">
      <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase text-[#858585]">
        <ShieldCheck className="size-3.5" aria-hidden="true" />
        {copy.evaluationFilterHeading}
      </span>
      <Button
        type="button"
        variant={active ? "ghost" : "outline"}
        size="sm"
        className="h-7 rounded-md px-2.5 text-xs"
        aria-pressed={!active}
        onClick={() => onChange?.("")}
      >
        {copy.allLabel || "All"}
      </Button>
      {available.map((filter) => (
        <Button
          key={filter.id}
          type="button"
          variant={active === filter.id ? "default" : "outline"}
          size="sm"
          className="h-7 rounded-md px-2.5 text-xs"
          aria-pressed={active === filter.id}
          onClick={() => onChange?.(active === filter.id ? "" : filter.id)}
        >
          {copy[filter.labelKey] || filter.id}
          <span className="ml-1.5 text-[#858585]">{formatLocalizedNumber(counts[filter.id], locale)}</span>
        </Button>
      ))}
    </section>
  );
}

function MissionEvaluationBadge({ state, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  if (!state || state === "none") return null;
  const meta =
    state === "all-pass"
      ? { dot: "bg-[#5d9f63]", text: "text-[#3d6a3f]", labelKey: "evaluationFilterAllPass" }
      : state === "some-fail"
        ? { dot: "bg-[#c0392b]", text: "text-[#a3271a]", labelKey: "evaluationFilterSomeFail" }
        : { dot: "bg-[#8a8a8a]", text: "text-[#666666]", labelKey: "evaluationFilterIncomplete" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", meta.text)}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden="true" />
      {copy[meta.labelKey] || state}
    </span>
  );
}

function MissionControlTable({ rows = [], evaluationStates, selectedRow, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE), navigate }) {
  return (
    <section aria-labelledby="mission-work-table">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="mission-work-table" className="text-xl font-semibold text-[#191815]">Active & Recent Work</h2>
          <p className="mt-1 text-sm text-[#666666]">Prioritized by latest movement.</p>
        </div>
        <span className="text-xs font-medium uppercase text-[#858585]">
          {formatLocalizedNumber(rows.length, locale)} Records
        </span>
      </div>

      <div className="grid gap-3 xl:hidden">
        {rows.map((row) => (
          <MissionControlCard key={row.id} row={row} selected={selectedRow?.id === row.id} copy={copy} locale={locale} navigate={navigate} />
        ))}
      </div>

      <div className="hidden border-y border-[#dedede] xl:block">
        <Table>
          <TableHeader>
            <TableRow className="border-[#dedede] hover:bg-transparent">
              <TableHead className="w-[230px] text-xs uppercase text-[#858585]">Member</TableHead>
              <TableHead className="text-xs uppercase text-[#858585]">Task</TableHead>
              <TableHead className="w-[260px] text-xs uppercase text-[#858585]">Repository & Run</TableHead>
              <TableHead className="w-[340px] text-xs uppercase text-[#858585]">Blocker & Evidence</TableHead>
              <TableHead className="w-[210px] text-xs uppercase text-[#858585]">Next Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={cn("border-[#e8e8e8] align-top hover:bg-[#f2f2f2]", selectedRow?.id === row.id && "bg-[#f2f2f2]")}>
                <TableCell className="whitespace-normal px-4 py-4">
                  <MissionMemberCell row={row} copy={copy} navigate={navigate} />
                </TableCell>
                <TableCell className="max-w-[28rem] whitespace-normal px-4 py-4">
                  <MissionAnchor
                    href={row.detailPath}
                    navigate={navigate}
                    className="text-left font-semibold leading-5 text-[#191815] hover:text-[#3f6f3c] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60"
                  >
                    {row.title}
                  </MissionAnchor>
                  <p className="mt-2 line-clamp-3 text-xs leading-5 text-[#666666]">{row.summary}</p>
                  <MissionRowLinks row={row} navigate={navigate} />
                </TableCell>
                <TableCell className="whitespace-normal px-4 py-4">
                  <div className="truncate font-mono text-xs text-[#555555]">{row.repository}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <MissionStatusPill status={row.status} copy={copy} />
                    {row.runtimeId ? <span className="max-w-[9rem] truncate font-mono text-[11px] text-[#858585]">{compactRecordId(row.runtimeId)}</span> : null}
                  </div>
                  {evaluationStates?.get(row.id) ? (
                    <div className="mt-2">
                      <MissionEvaluationBadge state={evaluationStates.get(row.id)} copy={copy} />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-normal px-4 py-4">
                  <MissionRiskAndEvidence row={row} />
                </TableCell>
                <TableCell className="whitespace-normal px-4 py-4">
                  <MissionNextActionButton row={row} navigate={navigate} />
                  <time className="mt-2 block text-xs text-[#858585]">{formatRecordDate(row.updatedAt, locale, copy)}</time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function MissionControlCard({ row, selected, copy, locale, navigate }) {
  return (
    <article className={cn("border-t border-[#dedede] py-5", selected && "bg-[#f2f2f2] px-3")}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <MissionMemberCell row={row} copy={copy} navigate={navigate} />
        <MissionStatusPill status={row.status} copy={copy} />
      </div>
      <MissionAnchor
        href={row.detailPath}
        navigate={navigate}
        className="mt-4 block w-full break-words text-left text-lg font-semibold leading-6 text-[#191815] hover:text-[#3f6f3c] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60"
      >
        {row.title}
      </MissionAnchor>
      <p className="mt-2 text-sm leading-6 text-[#666666]">{row.summary}</p>
      <div className="mt-3 truncate text-xs font-mono text-[#555555]">{row.repository}</div>
      <MissionRiskAndEvidence row={row} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <MissionNextActionButton row={row} navigate={navigate} />
        <time className="text-xs text-[#858585]">{formatRecordDate(row.updatedAt, locale, copy)}</time>
      </div>
      <MissionRowLinks row={row} navigate={navigate} />
    </article>
  );
}

function MissionMemberCell({ row, copy = getLocaleCopy(DEFAULT_LOCALE), navigate }) {
  const owner = row.owner;
  return (
    <MissionAnchor
      href={row.profilePath}
      navigate={navigate}
      className="flex min-w-0 items-center gap-3 text-left hover:text-[#3f6f3c] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60"
    >
      {owner ? <AgentAvatar agent={owner} /> : <span className="grid size-10 place-items-center rounded-full bg-[#eeeeee]"><UserRound className="size-4" aria-hidden="true" /></span>}
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[#191815]">{owner?.name || "Unassigned"}</span>
        <span className="block truncate text-xs text-[#666666]">{owner ? localizedRole(owner, copy) : "Squad member"}</span>
      </span>
    </MissionAnchor>
  );
}

function MissionRiskAndEvidence({ row }) {
  const [permissionWarning] = row.permissionWarnings || [];
  return (
    <div className="mt-3 grid gap-2 xl:mt-0">
      {row.blocker ? (
        <div className="break-words border-l-2 border-[#c47a00] pl-3 text-xs leading-5 text-[#855800]">
          <span className="font-semibold">Risk: </span>
          {row.blocker}
        </div>
      ) : null}
      {permissionWarning ? (
        <div className="break-words border-l-2 border-[#c47a00] pl-3 text-xs leading-5 text-[#855800]">
          <span className="font-semibold">Permission: </span>
          {permissionWarning.message}
        </div>
      ) : null}
      <div className="break-words text-xs leading-5 text-[#555555]">
        <span className="font-semibold text-[#2f2f2f]">{row.evidence.type}: </span>
        {row.evidence.label}
      </div>
    </div>
  );
}

function MissionRowLinks({ row, navigate }) {
  const links = [
    row.task ? { id: "task", label: "Task", icon: LayoutList, path: row.taskPath } : null,
    row.runtimeId ? { id: "run", label: "Run", icon: TerminalSquare, path: row.runPath } : null,
    row.workspaceLink ? { id: "workspace", label: "Workspace", icon: FolderGit2, path: row.workspaceLink } : null,
  ].filter(Boolean);

  if (!links.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {links.map((link) => {
        const Icon = link.icon;
        return (
          <MissionAnchor
            key={link.id}
            href={link.path}
            navigate={navigate}
            className="inline-flex h-8 items-center gap-1.5 text-xs font-medium text-[#555555] underline-offset-4 transition-[color,text-decoration-color] hover:text-[#191815] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60"
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {link.label}
          </MissionAnchor>
        );
      })}
    </div>
  );
}

function MissionStatusPill({ status, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  return (
    <span className={cn("inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium capitalize", missionStatusClass(status))}>
      <span className={cn("mr-1.5 size-1.5 rounded-full", missionStatusDotClass(status))} aria-hidden="true" />
      {statusLabel(status, copy)}
    </span>
  );
}

function MissionNextActionButton({ row, navigate }) {
  const action = row.nextAction;
  const Icon = action.icon;
  return (
    <MissionAnchor
      href={action.path}
      navigate={navigate}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60",
        ["replay", "handoff"].includes(action.id)
          ? "bg-[#191815] text-white hover:bg-[#33302b]"
          : "bg-[#ededed] text-[#2f2f2f] hover:bg-[#dedede]"
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {action.label}
    </MissionAnchor>
  );
}

// Goal 09: recipe outcome surface for a mission row. Shows which expected
// evidence the run actually captured and the pass/fail state of each done
// criterion. Reads the normalized evidence timeline so it stays consistent with
// the timeline view; never invents a pass when evidence is missing.
function RecipeOutcomePanel({ row, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const text = recipeCopy(copy);
  const task = row?.task;
  const run = row?.run;
  const recipe = findRecipeById(task?.recipeId || run?.recipeId);
  const coverage = useMemo(() => (recipe ? recipeEvidenceCoverage(recipe, row) : null), [recipe, row]);
  const doneResults = useMemo(() => {
    if (!recipe) return null;
    return task?.recipeDoneCriteriaResults || evaluateRecipeDoneCriteria(task, run);
  }, [recipe, task, run]);

  if (!recipe) return null;

  const isTerminal = ["completed", "failed", "stopped", "cancelled"].includes(row.status);
  const passed = doneResults?.passed || 0;
  const total = doneResults?.total || 0;
  const summaryLine = !isTerminal
    ? text.criterionPending
    : doneResults?.summaryState === "all-pass"
      ? text.criteriaSummaryPass
      : formatCopy(text.criteriaSummaryFail, { passed, total });

  return (
    <section aria-labelledby="recipe-outcome-title" data-testid="recipe-outcome">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 id="recipe-outcome-title" className="text-xl font-semibold text-[#191815]">{recipe.name}</h3>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-[#dedede] px-2 py-0.5 text-[11px] font-medium uppercase text-[#666666]">
          <BookOpen className="size-3" aria-hidden="true" />
          {text.ranFromRecipe}
        </span>
      </div>

      {coverage ? (
        <div className="mb-5">
          <div className="text-xs font-medium uppercase text-[#858585]">
            {text.evidenceCaptured} — {formatCopy(text.evidenceCapturedCount, { captured: formatLocalizedNumber(coverage.capturedCount, locale), total: formatLocalizedNumber(coverage.expected.length, locale) })}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {coverage.items.map((item) => {
              const meta = TASK_EVIDENCE_EVENT_META.get(item.type);
              const Icon = item.captured ? Check : CircleSlash;
              return (
                <li key={item.type} className={cn("inline-flex items-center gap-1.5 text-sm", item.captured ? "text-[#3d6a3f]" : "text-[#858585]")}>
                  <Icon className="size-3.5" aria-hidden="true" />
                  {meta?.label || item.type}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {doneResults ? (
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase text-[#858585]">
            <ListChecks className="size-3.5" aria-hidden="true" />
            {text.doneCriteria}
            <span className="text-[#666666]">— {summaryLine}</span>
          </div>
          <ul className="mt-3 grid gap-2.5">
            {doneResults.results.map((criterion) => {
              const state = !isTerminal ? "pending" : criterion.state;
              const dot = state === "pass" ? "bg-[#5d9f63]" : state === "fail" ? "bg-[#c0392b]" : "bg-[#bdbdbd]";
              const stateLabel = state === "pass" ? text.criterionPass : state === "fail" ? text.criterionFail : text.criterionPending;
              return (
                <li key={criterion.id} className="flex items-start gap-2.5">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot)} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-[#2f2f2f]">
                      {criterion.label}
                      <span className="text-xs font-medium uppercase text-[#858585]">{stateLabel}</span>
                    </div>
                    {isTerminal && criterion.state === "fail" && criterion.missing.length ? (
                      <div className="mt-0.5 text-xs text-[#a3271a]">
                        {formatCopy(text.missingEvidence, {
                          types: criterion.missing.map((type) => TASK_EVIDENCE_EVENT_META.get(type)?.label || type).join(", "),
                        })}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function MissionDetailPanel({ row, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE), navigate }) {
  if (!row) {
    return (
      <section className="border-y border-[#dedede] py-6" aria-label="Task Record">
        <h2 className="text-xl font-semibold text-[#191815]">Task Record</h2>
        <p className="mt-2 text-sm leading-6 text-[#666666]">Select a work row to inspect its timeline and run output.</p>
      </section>
    );
  }

  const assignments = Array.isArray(row.task?.assignments) ? row.task.assignments.slice(-4).reverse() : [];

  return (
    <section className="border-y border-[#dedede] py-6" aria-labelledby="mission-detail-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <MissionStatusPill status={row.status} copy={copy} />
            <span className="font-mono text-[11px] text-[#858585]">{compactRecordId(row.task?.id || row.runtimeId || row.id)}</span>
          </div>
          <h2 id="mission-detail-title" className="text-pretty text-2xl font-semibold leading-7 text-[#191815]">{row.title}</h2>
          <p className="mt-2 text-sm text-[#666666]">{row.repository} / {row.owner?.name || "unassigned"}</p>
        </div>
        <MissionAnchor
          href={row.profilePath}
          navigate={navigate}
          className="inline-flex h-8 items-center gap-1.5 text-xs font-medium text-[#555555] underline-offset-4 transition-[color,text-decoration-color] hover:text-[#191815] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60"
        >
          <CircleUserRound className="size-3.5" aria-hidden="true" />
          Profile
        </MissionAnchor>
      </div>

      <div className="mt-6 grid gap-6">
        <MissionRiskAndEvidence row={row} />
        <div className="grid gap-5 border-y border-[#e4e4e4] py-4 md:grid-cols-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase text-[#858585]">Run State</div>
            <div className="mt-2 truncate text-sm font-semibold text-[#191815]">{statusLabel(row.status, copy)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase text-[#858585]">Updated</div>
            <div className="mt-2 truncate text-sm font-semibold text-[#191815]">{formatRecordDate(row.updatedAt, locale, copy)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase text-[#858585]">Next Action</div>
            <div className="mt-2 truncate text-sm font-semibold text-[#191815]">{row.nextAction.label}</div>
          </div>
        </div>

        {assignments.length ? (
          <div className="border-b border-[#e4e4e4] pb-5">
            <div className="mb-4 text-xs font-semibold uppercase text-[#858585]">Assignments</div>
            <div className="grid gap-4">
              {assignments.map((assignment) => (
                <div key={assignment.id} className="border-l-2 border-[#dedede] pl-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <MissionStatusPill status={assignment.status || "pending"} copy={copy} />
                    <span className="text-[#555555]">{assignment.reason || "Assignment"}</span>
                  </div>
                  {assignment.sourceEvidence ? <p className="mt-2 text-xs leading-5 text-[#666666]">{assignment.sourceEvidence}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <RecipeOutcomePanel row={row} locale={locale} copy={copy} />

        <TaskEvidenceTimeline row={row} locale={locale} copy={copy} navigate={navigate} />

        <ContextLayersPanel row={row} locale={locale} copy={copy} navigate={navigate} />
      </div>
    </section>
  );
}

function contextLayerSourceHref(layer, row) {
  if (!layer || !layer.included) return "";
  switch (layer.sourceRef) {
    case "agent":
      return row.owner ? memberProfilePath(row.owner.id, "home") : row.profilePath || "";
    case "memory":
      return row.owner ? memoryInboxPath(row.owner.id) : "";
    case "task":
      return row.taskPath || row.detailPath || "";
    case "run":
      return row.runPath || (row.runtimeId ? missionControlPath({ run: row.runtimeId }) : "");
    default:
      return "";
  }
}

function ContextLayersPanel({ row, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE), navigate }) {
  const manifest = useMemo(() => contextLayerManifestForRow(row), [row]);
  const [expandedLayer, setExpandedLayer] = useState("");
  const text = copy.contextLayers || {};
  const layerNames = text.layerNames || {};

  useEffect(() => {
    setExpandedLayer("");
  }, [row?.id]);

  const order = Array.isArray(manifest.order) && manifest.order.length ? manifest.order : CONTEXT_LAYER_ORDER;
  const byName = new Map((manifest.layers || []).map((layer) => [layer.name, layer]));
  const ordered = order.map((name) => byName.get(name)).filter(Boolean);
  const includedCount = ordered.filter((layer) => layer.included).length;

  if (!ordered.length) {
    return (
      <section aria-labelledby="context-layers-title" data-testid="context-layers">
        <h3 id="context-layers-title" className="text-xl font-semibold text-[#191815]">{text.title || "Context Layers"}</h3>
        <p className="mt-2 text-sm leading-6 text-[#666666]">{text.empty || "No context manifest was recorded for this run."}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="context-layers-title" data-testid="context-layers">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
        <h3 id="context-layers-title" className="inline-flex items-center gap-2 text-xl font-semibold text-[#191815]">
          <Layers className="size-4 text-[#858585]" aria-hidden="true" />
          {text.title || "Context Layers"}
        </h3>
        <div className="text-xs font-medium uppercase text-[#858585]">
          {formatCopy(text.caption || "{included} of {total} layers included", { included: includedCount, total: ordered.length })}
        </div>
      </div>
      <p className="mb-4 text-xs text-[#858585]">{text.orderNote || "Assembled top to bottom before the agent acted."}</p>

      <ol className="space-y-4 border-l border-[#dedede] pl-4">
        {ordered.map((layer, index) => {
          const included = Boolean(layer.included);
          const sourceHref = contextLayerSourceHref(layer, row);
          const expanded = expandedLayer === layer.name;
          const hasSummary = Boolean(layer.summary) && included;
          return (
            <li key={layer.name} className="relative min-w-0" data-layer={layer.name} data-included={included ? "true" : "false"}>
              <span
                className={cn("absolute -left-[21px] top-1.5 size-2 rounded-full", included ? "bg-[#8fb885]" : "bg-[#cfcfcf]")}
                aria-hidden="true"
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[11px] text-[#a3a3a3]">{String(index + 1).padStart(2, "0")}</span>
                <span className={cn("text-sm font-semibold", included ? "text-[#191815]" : "text-[#9a9a9a]")}>
                  {layerNames[layer.name] || layer.name}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[11px] font-medium uppercase",
                    included ? "text-[#5d9f63]" : "text-[#9a9a9a]"
                  )}
                >
                  {included ? <CircleDot className="size-3" aria-hidden="true" /> : <CircleSlash className="size-3" aria-hidden="true" />}
                  {included ? text.includedBadge || "Included" : text.absentBadge || "Absent"}
                </span>
              </div>

              {included ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#858585]">
                  {layer.source ? (
                    <span className="min-w-0">
                      <span className="text-[#a3a3a3]">{text.sourceLabel || "Source"}:</span>{" "}
                      <span className="break-all font-mono text-[11px] text-[#666666]">{layer.source}</span>
                    </span>
                  ) : null}
                  {layer.contentHash ? (
                    <span className="font-mono text-[11px] text-[#a3a3a3]">{layer.contentHash}</span>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1.5 text-xs leading-5 text-[#9a9a9a]">{layer.reason || text.reasonFallback || "Not included in this run."}</p>
              )}

              {included ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {hasSummary ? (
                    <Button
                      type="button"
                      variant={expanded ? "default" : "outline"}
                      size="sm"
                      className="h-8 rounded-md text-xs"
                      aria-expanded={expanded}
                      onClick={() => setExpandedLayer((current) => (current === layer.name ? "" : layer.name))}
                    >
                      <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} aria-hidden="true" />
                      {expanded ? text.collapse || "Hide summary" : text.expand || "Show summary"}
                    </Button>
                  ) : null}
                  {sourceHref ? (
                    <MissionAnchor
                      href={sourceHref}
                      navigate={navigate}
                      className="inline-flex h-8 items-center gap-1.5 text-xs font-medium text-[#555555] underline-offset-4 hover:text-[#191815] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60"
                    >
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      {text.viewSource || "View source"}
                    </MissionAnchor>
                  ) : null}
                </div>
              ) : null}

              {included && expanded ? (
                <p className="mt-2 max-w-prose text-sm leading-6 text-[#555555]">{layer.summary || text.noSummary || "No summary captured for this layer."}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// Goal 08: Context Packs — resolve a source link for a pack item so every
// included file/route/screenshot stays traceable to its origin.
function contextPackItemLink(row, sourceRef, value) {
  switch (sourceRef) {
    case "file":
      return value ? timelineFileLink(row, value) : "";
    case "route":
      return value && value.startsWith("/") ? value : "";
    default:
      return "";
  }
}

function formatPackBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

// Inline, compact pack summary for a context-pack timeline event, with an
// inspect button that opens the full manifest dialog.
function ContextPackBlock({ pack, row, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE), navigate }) {
  const [open, setOpen] = useState(false);
  const text = copy.contextPack || {};
  if (!pack) return null;
  const counts = pack.counts || {};
  const stats = [
    formatCopy(text.statFiles || "{count} files", { count: counts.files ?? (pack.included?.files?.length || 0) }),
    formatCopy(text.statDiffs || "{count} diffs", { count: counts.diffs ?? (pack.included?.recentDiff ? 1 : 0) }),
    formatCopy(text.statFailures || "{count} prior failures", { count: counts.priorFailures ?? (pack.included?.priorFailures?.length || 0) }),
    formatCopy(text.statScreenshots || "{count} screenshots", { count: counts.screenshots ?? (pack.included?.screenshots?.length || 0) }),
  ];

  return (
    <div className="mt-4 border-y border-[#e4e4e4] py-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[#5d7a4e]">
          <Boxes className="size-3.5" aria-hidden="true" />
          {text.heading || "Context pack"}
          {pack.id ? <span className="font-mono text-[11px] font-medium normal-case text-[#858585]">{pack.id}</span> : null}
        </div>
        {counts.omitted ? (
          <span className="text-xs text-[#858585]">{formatCopy(text.omittedCount || "{count} omitted", { count: counts.omitted })}</span>
        ) : null}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#666666]">
        {stats.map((stat) => (
          <li key={stat}>{stat}</li>
        ))}
      </ul>
      <div className="mt-3">
        <Button type="button" variant="outline" size="sm" className="h-8 rounded-md text-xs" onClick={() => setOpen(true)}>
          <ScanSearch data-icon="inline-start" />
          {text.inspect || "Inspect pack"}
        </Button>
      </div>
      <ContextPackInspectDialog pack={pack} row={row} open={open} onOpenChange={setOpen} locale={locale} copy={copy} navigate={navigate} />
    </div>
  );
}

// Full pack manifest dialog: included sections (repo summary, files with
// excerpts and source links, recent diff, prior failures, preferences, active
// route, screenshots) and what was omitted with reasons. Large excerpts stay
// collapsed behind expanders while their source links remain available.
function ContextPackInspectDialog({ pack, row, open, onOpenChange, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE), navigate }) {
  const [expandedFile, setExpandedFile] = useState("");
  const text = copy.contextPack || {};

  useEffect(() => {
    if (!open) setExpandedFile("");
  }, [open]);

  if (!pack) return null;
  const included = pack.included || {};
  const files = Array.isArray(included.files) ? included.files : [];
  const diff = included.recentDiff || null;
  const failures = Array.isArray(included.priorFailures) ? included.priorFailures : [];
  const preferences = Array.isArray(included.userPreferences) ? included.userPreferences : [];
  const screenshots = Array.isArray(included.screenshots) ? included.screenshots : [];
  const omitted = Array.isArray(pack.omitted) ? pack.omitted : [];
  const repo = included.repoSummary || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-2xl" data-testid="context-pack-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-4 text-[#5d7a4e]" aria-hidden="true" />
            {text.dialogTitle || "Context pack"}
            {pack.id ? <span className="font-mono text-xs font-normal text-[#858585]">{pack.id}</span> : null}
          </DialogTitle>
          <DialogDescription>{pack.summary || text.dialogDescription || "Inspect what the agent started from."}</DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-6 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#858585]">
            {repo ? (
              <span>
                <span className="font-mono text-[#666666]">{repo.label}</span> · {repo.kind} · {formatCopy(text.repoFileCount || "{count} files", { count: repo.fileCount })}
              </span>
            ) : null}
            {Number.isFinite(pack.approxTokens) ? (
              <span>{formatCopy(text.budgetNote || "~{tokens} tokens (budget {budget})", { tokens: pack.approxTokens, budget: pack.softTokenBudget || 20000 })}</span>
            ) : null}
          </div>

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase text-[#5d7a4e]">{text.sectionIncluded || "Included"}</h4>

            <div className="space-y-4">
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-[#858585]">
                  <FileCode2 className="size-3.5" aria-hidden="true" />
                  {formatCopy(text.filesHeading || "Files ({count})", { count: files.length })}
                </div>
                {files.length ? (
                  <ul className="space-y-2 border-l border-[#dedede] pl-3">
                    {files.map((file) => {
                      const expanded = expandedFile === file.path;
                      const href = contextPackItemLink(row, "file", file.sourceRef || file.path);
                      return (
                        <li key={file.path} className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="break-all font-mono text-xs text-[#444444]">{file.path}</span>
                            {file.pinned ? <Badge variant="secondary" className="h-5 rounded px-1.5 text-[10px]">{text.pinned || "Pinned"}</Badge> : null}
                            <span className="text-[11px] text-[#a3a3a3]">{formatPackBytes(file.bytes)}</span>
                            {file.truncated ? <span className="text-[11px] text-[#c47a00]">{text.truncated || "truncated"}</span> : null}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {file.excerpt ? (
                              <Button
                                type="button"
                                variant={expanded ? "default" : "outline"}
                                size="sm"
                                className="h-7 rounded-md text-xs"
                                aria-expanded={expanded}
                                onClick={() => setExpandedFile((current) => (current === file.path ? "" : file.path))}
                              >
                                <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} aria-hidden="true" />
                                {expanded ? text.hideExcerpt || "Hide excerpt" : text.showExcerpt || "Show excerpt"}
                              </Button>
                            ) : null}
                            {href ? (
                              <MissionAnchor
                                href={href}
                                navigate={navigate}
                                className="inline-flex h-7 items-center gap-1.5 text-xs font-medium text-[#555555] underline-offset-4 hover:text-[#191815] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60"
                              >
                                <ArrowUpRight className="size-3.5" aria-hidden="true" />
                                {text.viewSource || "View source"}
                              </MissionAnchor>
                            ) : null}
                          </div>
                          {expanded && file.excerpt ? (
                            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words border border-[#e4e4e4] bg-[#fafafa] p-2 font-mono text-[11px] leading-5 text-[#444444]">
                              {file.excerpt}
                            </pre>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-[#858585]">{text.noFiles || "No file excerpts in this pack."}</p>
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-[#858585]">
                  <GitBranch className="size-3.5" aria-hidden="true" />
                  {text.diffHeading || "Recent diff"}
                </div>
                {diff ? (
                  <div className="space-y-2 border-l border-[#dedede] pl-3">
                    {diff.stat ? (
                      <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[#444444]">{diff.stat}</pre>
                    ) : null}
                    {Array.isArray(diff.recentCommits) && diff.recentCommits.length ? (
                      <ul className="space-y-0.5">
                        {diff.recentCommits.map((line) => (
                          <li key={line} className="font-mono text-[11px] text-[#666666]">{line}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-[#858585]">{text.noDiff || "No recent diff for this workspace."}</p>
                )}
              </div>

              {failures.length ? (
                <div>
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-[#858585]">
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    {formatCopy(text.failuresHeading || "Prior failures ({count})", { count: failures.length })}
                  </div>
                  <ul className="space-y-1 border-l border-[#dedede] pl-3">
                    {failures.map((failure, index) => (
                      <li key={failure.id || index} className="text-xs leading-5 text-[#666666]">{failure.summary}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {preferences.length ? (
                <div>
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-[#858585]">
                    <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                    {text.preferencesHeading || "User preferences"}
                  </div>
                  <ul className="space-y-1 border-l border-[#dedede] pl-3">
                    {preferences.map((pref, index) => (
                      <li key={index} className="text-xs leading-5 text-[#666666]">{pref}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {included.activeRoute ? (
                <div>
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-[#858585]">
                    <Globe2 className="size-3.5" aria-hidden="true" />
                    {text.routeHeading || "Active route"}
                  </div>
                  <div className="border-l border-[#dedede] pl-3">
                    {contextPackItemLink(row, "route", included.activeRoute) ? (
                      <MissionAnchor
                        href={contextPackItemLink(row, "route", included.activeRoute)}
                        navigate={navigate}
                        className="font-mono text-xs text-[#555555] underline-offset-4 hover:text-[#191815] hover:underline"
                      >
                        {included.activeRoute}
                      </MissionAnchor>
                    ) : (
                      <span className="font-mono text-xs text-[#666666]">{included.activeRoute}</span>
                    )}
                  </div>
                </div>
              ) : null}

              {screenshots.length ? (
                <div>
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-[#858585]">
                    <Monitor className="size-3.5" aria-hidden="true" />
                    {formatCopy(text.screenshotsHeading || "Screenshots ({count})", { count: screenshots.length })}
                  </div>
                  <ul className="space-y-1 border-l border-[#dedede] pl-3">
                    {screenshots.map((shot, index) => (
                      <li key={shot.path || index} className="truncate font-mono text-xs text-[#666666]">{shot.path || shot.label}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase text-[#9a9a9a]">{text.sectionOmitted || "Omitted"}</h4>
            {omitted.length ? (
              <ul className="space-y-1.5 border-l border-[#dedede] pl-3">
                {omitted.map((item, index) => (
                  <li key={index} className="text-xs leading-5 text-[#9a9a9a]">
                    <span className="font-medium text-[#666666]">{item.section || "item"}</span>
                    {item.path ? <span className="font-mono"> · {item.path}</span> : null}
                    <span> — {item.detail || item.reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#858585]">{text.noOmitted || "Nothing was omitted from this pack."}</p>
            )}
          </section>
        </div>

        <DialogFooter className="mt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {copy.close || "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskEvidenceTimeline({ row, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE), navigate }) {
  const events = useMemo(() => taskEvidenceTimeline(row), [row]);
  const [activeTypes, setActiveTypes] = useState([]);
  const [rawEventId, setRawEventId] = useState("");

  useEffect(() => {
    setActiveTypes([]);
    setRawEventId("");
  }, [row?.id]);

  const availableTypes = TASK_EVIDENCE_EVENT_TYPES.filter((type) => events.some((event) => event.evidenceType === type.id));
  const visibleEvents = activeTypes.length ? events.filter((event) => activeTypes.includes(event.evidenceType)) : events;
  const rawEvent = events.find((event) => event.id === rawEventId) || null;

  return (
    <section aria-labelledby="task-evidence-timeline" data-testid="task-evidence-timeline">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="task-evidence-timeline" className="text-xl font-semibold text-[#191815]">Evidence Timeline</h3>
          <div className="mt-1 text-xs font-medium uppercase text-[#858585]">{visibleEvents.length} of {events.length} Events</div>
        </div>
        {availableTypes.length ? (
          <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1">
            <Button
              type="button"
              variant={activeTypes.length ? "ghost" : "outline"}
              size="sm"
              className="h-8 shrink-0 rounded-md px-2.5 text-xs"
              onClick={() => setActiveTypes([])}
            >
              <LayoutList data-icon="inline-start" />
              All
            </Button>
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              value={activeTypes}
              onValueChange={(value) => setActiveTypes(Array.isArray(value) ? value : value ? [value] : [])}
              className="shrink-0"
              aria-label="Filter evidence timeline"
            >
              {availableTypes.map((type) => {
                const Icon = type.icon;
                return (
                  <ToggleGroupItem key={type.id} value={type.id} className="h-8 gap-1.5 rounded-md px-2.5 text-xs">
                    <Icon className="size-3.5" aria-hidden="true" />
                    {type.label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>
        ) : null}
      </div>

      <div className="space-y-5 border-l border-[#dedede] pl-4">
        {visibleEvents.map((event) => (
          <TaskEvidenceEvent
            key={event.id}
            event={event}
            row={row}
            locale={locale}
            copy={copy}
            navigate={navigate}
            rawSelected={rawEventId === event.id}
            onOpenRaw={() => setRawEventId((current) => (current === event.id ? "" : event.id))}
          />
        ))}
      </div>

      <RawEvidenceLogPanel event={rawEvent} locale={locale} copy={copy} />
    </section>
  );
}

function TaskEvidenceEvent({ event, row, locale, copy, navigate, rawSelected, onOpenRaw }) {
  const meta = TASK_EVIDENCE_EVENT_META.get(event.evidenceType) || TASK_EVIDENCE_EVENT_TYPES[0];
  const Icon = meta.icon;
  const canOpenRaw = TASK_RAW_EVENT_TYPES.has(event.evidenceType) && (event.rawLogs.length || event.command || event.logPath || event.runId);
  const eventRunPath = event.runId ? row.runPath || missionControlPath({ run: event.runId }) : "";
  const dotClass =
    event.evidenceType === "risk"
      ? "bg-[#c47a00]"
      : event.evidenceType === "final"
        ? "bg-[#5d9f63]"
        : event.evidenceType === "evaluation"
          ? "bg-[#4a6b8a]"
          : event.evidenceType === "screenshot"
            ? "bg-[#4f94c5]"
            : "bg-[#8fb885]";

  return (
    <article className="relative min-w-0" data-evidence-type={event.evidenceType}>
      <span className={cn("absolute -left-[21px] top-1.5 size-2 rounded-full", dotClass)} aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#666666]">
        <span className="inline-flex items-center gap-1.5 font-semibold uppercase text-[#858585]">
          <Icon className="size-3.5" aria-hidden="true" />
          {meta.label}
        </span>
        <time>{formatRecordDate(event.at, locale, copy)}</time>
        {event.type ? <span className="font-mono text-[11px] text-[#858585]">{event.type.replaceAll(".", " ")}</span> : null}
      </div>
      <p className="mt-1 text-sm leading-6 text-[#555555]">{event.summary}</p>

      {event.command ? (
        <code className="mt-2 block whitespace-normal break-words font-mono text-xs leading-5 text-[#555555]">{event.command}</code>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {eventRunPath ? (
          <MissionAnchor
            href={eventRunPath}
            navigate={navigate}
            className="inline-flex h-8 items-center gap-1.5 text-xs font-medium text-[#555555] underline-offset-4 hover:text-[#191815] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60"
          >
            <TerminalSquare className="size-3.5" aria-hidden="true" />
            {compactRecordId(event.runId)}
          </MissionAnchor>
        ) : null}
        {canOpenRaw ? (
          <Button
            type="button"
            variant={rawSelected ? "default" : "outline"}
            size="sm"
            className="h-8 rounded-md text-xs"
            aria-controls="task-raw-log"
            onClick={onOpenRaw}
          >
            <Command data-icon="inline-start" />
            Raw log
          </Button>
        ) : null}
        {event.logPath ? <span className="max-w-full truncate font-mono text-[11px] text-[#858585]">{event.logPath}</span> : null}
      </div>

      {event.files.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {event.files.map((file) => (
            <MissionAnchor
              key={file.path}
              href={timelineFileLink(row, file.path)}
              navigate={navigate}
              className="inline-flex max-w-full items-center gap-1.5 truncate text-xs font-medium text-[#555555] underline-offset-4 hover:text-[#191815] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#b7d7ad]/60"
            >
              <FileCode2 className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{file.path}</span>
            </MissionAnchor>
          ))}
        </div>
      ) : null}

      {event.screenshotPath ? (
        <div className="mt-3 inline-flex max-w-full items-center gap-1.5 truncate font-mono text-xs text-[#555555]">
          <Monitor className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{event.screenshotPath}</span>
        </div>
      ) : null}

      {event.evidenceType === "final" ? <FinalEvidenceBlock event={event} /> : null}
      {event.evidenceType === "evaluation" && event.evaluation ? (
        <EvaluationCheckBlock evaluation={event.evaluation} row={row} locale={locale} copy={copy} navigate={navigate} />
      ) : null}
      {event.evidenceType === "context-pack" && event.contextPack ? (
        <ContextPackBlock pack={event.contextPack} row={row} locale={locale} copy={copy} navigate={navigate} />
      ) : null}
    </article>
  );
}

// Goal 07: render recorded trust checks. Each check shows its state, reason,
// decision logic, confidence, and an inspectable, source-backed evidence list.
function EvaluationCheckBlock({ evaluation, row, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE), navigate }) {
  const [openCheckId, setOpenCheckId] = useState("");
  if (!evaluation) return null;

  return (
    <div className="mt-4 border-y border-[#e4e4e4] py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[#3f5e7a]">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          {copy.evaluationSummaryHeading}
        </div>
        <span className="text-xs text-[#666666]">
          {formatCopy(copy.evaluationPassedOf, { passed: evaluation.passed, total: evaluation.total })}
        </span>
      </div>
      {evaluation.summaryState === "some-fail" ? (
        <p className="mb-3 border-l-2 border-[#c0392b] pl-3 text-xs leading-5 text-[#a3271a]">{copy.evaluationLowTrustNotice}</p>
      ) : null}
      <ul className="space-y-3">
        {evaluation.checks.map((check) => {
          const stateMeta = evaluationStateMeta(check.state);
          const StateIcon = stateMeta.icon;
          const isOpen = openCheckId === check.id;
          const stateLabel = copy[stateMeta.labelKey] || check.state;
          return (
            <li key={check.id} className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", stateMeta.text)}>
                  <StateIcon className="size-3.5" aria-hidden="true" />
                  {stateLabel}
                </span>
                <span className="text-sm font-medium text-[#2f2f2f]">{evaluationCheckLabel(check.id, copy)}</span>
                <span className="text-[11px] uppercase text-[#858585]">
                  {check.decision === "model" ? copy.evaluationDecisionModel : copy.evaluationDecisionDeterministic}
                </span>
                <span className="text-[11px] uppercase text-[#858585]">{copy[EVALUATION_CONFIDENCE_KEYS[check.confidence]] || check.confidence}</span>
              </div>
              {check.reason ? <p className="mt-1 text-xs leading-5 text-[#555555]">{check.reason}</p> : null}
              {check.state === "unknown" ? (
                <p className="mt-1 text-xs leading-5 text-[#777777]">{copy.evaluationUnknownNotice}</p>
              ) : null}
              {check.evidence.length ? (
                <Button
                  type="button"
                  variant={isOpen ? "default" : "outline"}
                  size="sm"
                  className="mt-2 h-7 rounded-md text-xs"
                  aria-expanded={isOpen}
                  onClick={() => setOpenCheckId((current) => (current === check.id ? "" : check.id))}
                >
                  <ScanSearch data-icon="inline-start" />
                  {isOpen ? copy.evaluationHideEvidence : copy.evaluationInspectEvidence}
                </Button>
              ) : (
                <p className="mt-1 text-[11px] italic text-[#858585]">{copy.evaluationNoEvidence}</p>
              )}
              {isOpen && check.evidence.length ? (
                <ul className="mt-2 space-y-1.5 border-l border-[#dedede] pl-3">
                  {check.evidence.map((item, index) => {
                    const fileHref = item.source === "file" ? timelineFileLink(row, item.label) : "";
                    return (
                      <li key={`${check.id}-ev-${index}`} className="min-w-0 text-xs leading-5 text-[#555555]">
                        <span className="mr-1.5 font-mono text-[10px] uppercase text-[#858585]">{item.source}</span>
                        {fileHref ? (
                          <MissionAnchor
                            href={fileHref}
                            navigate={navigate}
                            className="break-all font-mono text-[#3f5e7a] underline-offset-4 hover:underline"
                          >
                            {item.label}
                          </MissionAnchor>
                        ) : (
                          <span className="break-words font-mono text-[#444444]">{item.label}</span>
                        )}
                        {item.detail ? <span className="ml-1.5 text-[#858585]">— {item.detail}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {evaluation.evaluatorNote ? <p className="mt-3 text-xs leading-5 text-[#666666]">{evaluation.evaluatorNote}</p> : null}
      {evaluation.evaluatedAt ? (
        <p className="mt-1 text-[11px] text-[#858585]">
          {formatCopy(copy.evaluationEvaluatedAt, { time: formatRecordDate(evaluation.evaluatedAt, locale, copy) })}
        </p>
      ) : null}
    </div>
  );
}

function FinalEvidenceBlock({ event }) {
  const confirmed = event.confirmedEvidence.length ? event.confirmedEvidence : [event.summary].filter(Boolean);
  const risks = event.unresolvedRisks || [];

  return (
    <div className="mt-4 grid gap-4 border-y border-[#e4e4e4] py-4 md:grid-cols-2">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase text-[#3d6a3f]">Confirmed Evidence</div>
        <ul className="space-y-2">
          {confirmed.map((item) => (
            <li key={item} className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-2 text-xs leading-5 text-[#555555]">
              <span className="mt-2 size-1.5 rounded-full bg-[#5d9f63]" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase text-[#8a4b00]">Unresolved Risk</div>
        {risks.length ? (
          <ul className="space-y-2">
            {risks.map((item) => (
              <li key={item} className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-2 text-xs leading-5 text-[#855800]">
                <span className="mt-2 size-1.5 rounded-full bg-[#c47a00]" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs leading-5 text-[#666666]">No unresolved risk recorded.</p>
        )}
      </div>
    </div>
  );
}

function RawEvidenceLogPanel({ event, locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  if (!event) return null;
  const lines = event.rawLogs || [];

  return (
    <div id="task-raw-log" data-testid="task-raw-log-panel" className="mt-5 border-t border-[#e4e4e4] pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[#858585]">
          <TerminalSquare className="size-3.5" aria-hidden="true" />
          Raw Output
        </div>
        <time className="text-xs text-[#858585]">{formatRecordDate(event.at, locale, copy)}</time>
      </div>
      {event.command ? <code className="mb-3 block whitespace-normal break-words font-mono text-xs leading-5 text-[#555555]">{event.command}</code> : null}
      {event.logPath ? <div className="mb-3 truncate font-mono text-[11px] text-[#858585]">{event.logPath}</div> : null}
      <pre className="max-h-72 overflow-auto bg-[#191815] p-4 text-xs leading-5 text-[#f4f1e8]">
        {lines.length
          ? lines.map((log) => `[${log.source || "run"}] ${log.line || ""}`).join("\n")
          : "Raw log has not reported output yet."}
      </pre>
    </div>
  );
}

function MissionStateMatrix() {
  return (
    <aside className="border-y border-[#dedede] py-6" aria-labelledby="mission-state-matrix">
      <h2 id="mission-state-matrix" className="text-xl font-semibold text-[#191815]">State Matrix</h2>
      <p className="mt-2 text-sm leading-6 text-[#666666]">Operational meanings for each work state.</p>
      <div className="mt-5 grid gap-0">
        {MISSION_STATE_MATRIX.map((row) => (
          <div key={row.status} className="border-t border-[#e4e4e4] py-4 first:border-t-0">
            <div className="mb-3">
              <MissionStatusPill status={row.status} />
            </div>
            <div className="text-sm leading-5 text-[#2f2f2f]">{row.treatment}</div>
            <div className="mt-2 text-xs leading-5 text-[#666666]">{row.evidence}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function missionControlLoadState({ runtime, rows, runsError, workspacesError }) {
  if (runtime === null) return "loading";
  if (runsError || workspacesError) return "failed";
  if (!runtime?.available) return "no-runtime";
  if (!rows.length) return "empty";
  return "ready";
}

function missionControlCounts({ agents = [], tasks = [], runtime, memoryInbox = [] } = {}) {
  const memoryPending = memoryInbox.filter((item) => item?.status === "pending").length;
  const permissionWarnings = agents.filter((agent) => missionPermissionWarning(agent, runtime)).length;
  return {
    tasks: tasks.filter((task) => task?.status !== "cancelled").length,
    memoryPending,
    permissionWarnings,
  };
}

function permissionWarningsForAgent(agent, runtime, workspace = agent?.workspace) {
  const permissions = resolveAgentPermissionsForWorkspace(agent, workspace);
  const ladder = autonomyLadderLevelMeta(permissions.ladderLevel);
  const warnings = [];

  if (runtime?.available === false) {
    warnings.push({
      id: "runtime-offline",
      severity: "high",
      message: "Local runtime is offline, so permission checks cannot be verified live.",
    });
  }
  if (permissions.permissionMode === "unrestricted") {
    warnings.push({
      id: "unrestricted",
      severity: "high",
      message: "Unrestricted mode can approve broad tool use; use a ladder level with explicit approval gates.",
    });
  }
  if (permissions.allPathsAllowed) {
    warnings.push({
      id: "all-paths",
      severity: "medium",
      message: "All workspace paths are allowed for this member.",
    });
  }
  if (permissions.allUrlsAllowed) {
    warnings.push({
      id: "all-urls",
      severity: "medium",
      message: "External URL access is allowed without the usual URL gate.",
    });
  }
  if (!permissions.toolGuardEnabled || !permissions.fileGuardEnabled || !permissions.builtInToolPolicyEnabled || !permissions.shellEvasionEnabled) {
    warnings.push({
      id: "guard-disabled",
      severity: "high",
      message: "One or more guard layers are disabled for this workspace.",
    });
  }
  if (permissions.modes["shell.destructive"] !== "block") {
    warnings.push({
      id: "destructive-shell",
      severity: "high",
      message: "Destructive shell commands are not fully blocked.",
    });
  }
  if (permissions.builtInPolicies.git_merge !== "block") {
    warnings.push({
      id: "merge-enabled",
      severity: "high",
      message: "Git merge actions should stay blocked; auto-merge is disabled by product policy.",
    });
  }
  if (PR_READY_LADDER_LEVELS.has(ladder.id)) {
    const githubTool = (Array.isArray(agent?.tools) ? agent.tools : []).find((tool) => String(tool?.name || "").toLowerCase().includes("github"));
    const githubReady = ["ready", "wired", "isolated"].includes(String(githubTool?.status || "").toLowerCase());
    if (!githubReady) {
      warnings.push({
        id: "github-not-ready",
        severity: "medium",
        message: "Open PR level needs GitHub connector readiness before draft PR approval can proceed.",
      });
    }
  }

  return warnings;
}

function missionPermissionWarning(agent, runtime) {
  return permissionWarningsForAgent(agent, runtime).length > 0;
}

function buildMissionRows({ agents = [], tasks = [], runs = [], runtime, workspaces = [] } = {}) {
  const runById = new Map(runs.map((run) => [run.id, run]));
  const linkedRunIds = new Set();
  const taskRows = tasks.map((task) => {
    const run = task.runtimeId ? runById.get(task.runtimeId) : null;
    if (run?.id) linkedRunIds.add(run.id);
    return missionRowFromTask(task, run, agents, runtime, workspaces);
  });
  const runRows = runs
    .filter((run) => run?.id && !linkedRunIds.has(run.id))
    .map((run) => missionRowFromRun(run, agents, runtime, workspaces));

  return [...taskRows, ...runRows]
    .filter(Boolean)
    .sort((left, right) => missionTime(right.updatedAt) - missionTime(left.updatedAt));
}

function missionRowFromTask(task, run, agents, runtime, workspaces) {
  const owner = taskOwner(task, agents) || agents.find((agent) => agent.id === task.agentId);
  const runtimeId = run?.id || task.runtimeId || "";
  const workspacePath = normalizePath(run?.workspace || owner?.workspace || missionWorkspacePath(task.project, workspaces));
  const repository = workspaceName(workspacePath) || task.project || "workspace";
  const status = missionTaskStatus(task, run);
  const detailPath = missionControlPath({ task: task.id });
  const runPath = missionControlPath({ run: runtimeId });
  const profilePath = owner ? memberProfilePath(owner.id, "home") : missionControlPath();
  const taskPath = owner ? `${memberProfilePath(owner.id, "task")}?task=${encodeURIComponent(task.id)}` : detailPath;
  const workspacePathTarget = owner ? `${memberProfilePath(owner.id, "project")}?workspace=${encodeURIComponent(workspacePath)}` : detailPath;

  return {
    id: `task-${task.id}`,
    type: "task",
    task,
    run,
    owner,
    title: task.title || run?.title || "Untitled task",
    summary: task.summary || run?.command || "No summary recorded yet.",
    status,
    runtimeId,
    repository,
    workspace: workspacePath,
    profilePath,
    taskPath,
    runPath,
    workspaceLink: workspacePath ? workspacePathTarget : "",
    detailPath,
    blocker: missionBlocker(task),
    permissionWarnings: owner ? permissionWarningsForAgent(owner, runtime, workspacePath) : [],
    evidence: missionLastEvidence(task, run),
    nextAction: missionNextAction(status, detailPath, runPath),
    updatedAt: task.updatedAt || run?.updatedAt || run?.startedAt || task.createdAt,
  };
}

function missionRowFromRun(run, agents, runtime, workspaces) {
  const owner = agents.find((agent) => agent.id === run.agentId);
  const workspacePath = normalizePath(run.workspace || owner?.workspace || "");
  const repository = workspaceName(workspacePath) || missionWorkspacePath(run.workspace, workspaces) || "workspace";
  const detailPath = missionControlPath({ run: run.id });
  const profilePath = owner ? memberProfilePath(owner.id, "home") : missionControlPath();
  const workspacePathTarget = owner ? `${memberProfilePath(owner.id, "project")}?workspace=${encodeURIComponent(workspacePath)}` : detailPath;
  const status = run.status || "running";

  return {
    id: `run-${run.id}`,
    type: "run",
    task: null,
    run,
    owner,
    title: run.title || run.command || "Standalone run",
    summary: run.command || "Run output is available from the local bridge.",
    status,
    runtimeId: run.id,
    repository,
    workspace: workspacePath,
    profilePath,
    taskPath: detailPath,
    runPath: detailPath,
    workspaceLink: workspacePath ? workspacePathTarget : "",
    detailPath,
    blocker: status === "failed" ? "Standalone run failed before a parent task was linked." : "",
    permissionWarnings: owner ? permissionWarningsForAgent(owner, runtime, workspacePath) : [],
    evidence: { type: "command", label: run.command || "Run command not recorded." },
    nextAction: missionNextAction(status, detailPath, detailPath),
    updatedAt: run.updatedAt || run.completedAt || run.startedAt || new Date().toISOString(),
  };
}

function missionTaskStatus(task, run) {
  if (task?.status) return task.status;
  if (run?.status) return run.status;
  return "pending";
}

function missionCurrentRowForAgent(agent, rows = []) {
  const agentRows = rows.filter((row) => row.owner?.id === agent.id);
  return (
    agentRows.find((row) => !["completed", "cancelled"].includes(row.status)) ||
    agentRows[0] ||
    null
  );
}

function missionWorkspacePath(value, workspaces = []) {
  const needle = String(value || "").toLowerCase();
  if (!needle) return "";
  const match = workspaces.find((workspace) => {
    const label = String(workspace.label || "").toLowerCase();
    const name = String(workspace.name || "").toLowerCase();
    const path = String(workspace.path || "").toLowerCase();
    return needle === label || needle === name || path.endsWith(`/${needle}`) || label.includes(needle);
  });
  return match?.path || "";
}

function missionBlocker(task) {
  const failedHandoff = latestFailedHandoff(task);
  const failedAssignment = [...(Array.isArray(task?.assignments) ? task.assignments : [])]
    .reverse()
    .find((assignment) => assignment.status === "failed" || assignment.failureReason);
  if (failedHandoff?.failureReason) return failedHandoff.failureReason;
  if (failedAssignment?.failureReason) return failedAssignment.failureReason;
  if (["blocked", "failed"].includes(task?.status)) return task.summary || "Blocked without a recorded reason.";
  const pendingHandoff = latestPendingHandoff(task);
  if (pendingHandoff) return `Awaiting handoff review: ${pendingHandoff.reason || pendingHandoff.expectedOutput || "receiving member has not accepted yet."}`;
  return "";
}

function missionLastEvidence(task, run) {
  const assignments = [...(Array.isArray(task?.assignments) ? task.assignments : [])].reverse();
  const handoffs = [...(Array.isArray(task?.handoffs) ? task.handoffs : [])].reverse();
  const timeline = [...(Array.isArray(task?.timeline) ? task.timeline : [])].reverse();
  const evidenceText =
    assignments.find((assignment) => assignment.sourceEvidence)?.sourceEvidence ||
    handoffs.find((handoff) => handoff.sourceEvidence)?.sourceEvidence ||
    (run?.logs || []).at?.(-1)?.line ||
    run?.command ||
    timeline.find((event) => event.content || event.summary)?.content ||
    timeline.find((event) => event.summary)?.summary ||
    task?.summary ||
    "No evidence captured yet.";

  return {
    type: missionEvidenceType(evidenceText),
    label: evidenceText,
  };
}

function missionEvidenceType(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("screenshot")) return "screenshot";
  if (value.includes("file") || value.includes("diff") || value.includes("touched")) return "file change";
  if (value.includes("test") || value.includes("build") || value.includes("deploy")) return "test result";
  if (value.includes("command") || value.includes("run ")) return "command";
  if (value.includes("review") || value.includes("approval")) return "review note";
  return "evidence";
}

function missionNextAction(status, detailPath, runPath) {
  if (status === "completed") return { id: "archive", label: "Archive", icon: History, path: detailPath };
  if (status === "failed") return { id: "replay", label: "Replay", icon: RefreshCw, path: runPath || detailPath };
  if (status === "blocked") return { id: "handoff", label: "Hand Off", icon: Workflow, path: detailPath };
  if (status === "handoff-pending") return { id: "review", label: "Review", icon: ClipboardCheck, path: detailPath };
  if (status === "pending") return { id: "approve", label: "Approve", icon: BadgeCheck, path: detailPath };
  return { id: "continue", label: "Continue", icon: Play, path: runPath || detailPath };
}

function missionStatusClass(status) {
  if (status === "completed") return "bg-[#eef7ec] text-[#3d6a3f]";
  if (status === "failed") return "bg-[#fff1ee] text-[#9b3726]";
  if (status === "blocked") return "bg-[#fff2df] text-[#8a4b00]";
  if (status === "running" || status === "launching") return "bg-[#edf6ff] text-[#27638f]";
  if (status === "handoff-pending") return "bg-[#f2efff] text-[#6350a6]";
  if (status === "online" || status === "ready") return "bg-[#eeeeee] text-[#555555]";
  return "bg-[#eeeeee] text-[#666666]";
}

function missionStatusDotClass(status) {
  if (status === "completed") return "bg-[#5d9f63]";
  if (status === "failed") return "bg-[#d44d36]";
  if (status === "blocked") return "bg-[#c47a00]";
  if (status === "running" || status === "launching") return "bg-[#4f94c5]";
  if (status === "handoff-pending") return "bg-[#7a68c7]";
  return "bg-[#858585]";
}

function missionTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
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
  const brainCard = brainCardForAgent(agent);
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

          <section className="mt-6 rounded-md border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <Brain className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-muted-foreground">Brain card</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-foreground/88">{brainCard.purpose}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {["definitionOfDone", "memoryPolicy"].map((fieldId) => {
                const field = brainCardFields.find((item) => item.id === fieldId);
                return (
                  <div key={fieldId} className="rounded-md bg-background/70 p-3">
                    <div className="text-[11px] font-medium uppercase text-muted-foreground">{field?.label || fieldId}</div>
                    <p className="mt-1 max-h-24 overflow-auto text-sm leading-5 text-muted-foreground">{brainCard[fieldId]}</p>
                  </div>
                );
              })}
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
            {run.effectiveModel ? (
              <div className="mt-1 truncate text-[11px] text-muted-foreground">
                Model: {providerSummaryLabel(run.effectiveModel)} ({run.effectiveModel.source || "workspace"})
              </div>
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
      return { agent, recommended: score >= 0, score: score >= 0 ? score : 99, recommendation: brainCardForAgent(agent).whyThisAgent };
    })
    .sort((left, right) => left.score - right.score || String(left.agent.name).localeCompare(String(right.agent.name)));
}

// Goal 09: Run Recipes — recipe catalog + launch preview UI. The catalog dialog
// lists role-applicable recipes; selecting one opens the launch preview that
// shows the expected evidence checklist, required permission level, model,
// tools, and scope before the run starts.
function recipeCopy(copy = getLocaleCopy(DEFAULT_LOCALE)) {
  return copy.recipes || getLocaleCopy(DEFAULT_LOCALE).recipes || {};
}

function RecipeMetaList({ recipe, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const text = recipeCopy(copy);
  const level = autonomyLadderLevelMeta(recipe.permissionLevel);
  const expected = Array.isArray(recipe.expectedEvidence) ? recipe.expectedEvidence : [];
  return (
    <div className="grid gap-4">
      <Field className="gap-2">
        <FieldLabel className="text-xs font-medium uppercase text-muted-foreground">{text.requiredPermission}</FieldLabel>
        <div className="flex items-center gap-2 text-sm">
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          {level.label}
        </div>
      </Field>
      <Field className="gap-2">
        <FieldLabel className="text-xs font-medium uppercase text-muted-foreground">{text.expectedEvidence}</FieldLabel>
        <ul className="grid gap-1.5">
          {expected.map((type) => {
            const meta = TASK_EVIDENCE_EVENT_META.get(type);
            const Icon = meta?.icon || ClipboardCheck;
            return (
              <li key={type} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                {meta?.label || type}
              </li>
            );
          })}
        </ul>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field className="gap-1.5">
          <FieldLabel className="text-xs font-medium uppercase text-muted-foreground">{text.model}</FieldLabel>
          <span className="font-mono text-xs text-muted-foreground">{recipe.model || "inherit"}</span>
        </Field>
        <Field className="gap-1.5">
          <FieldLabel className="text-xs font-medium uppercase text-muted-foreground">{text.tools}</FieldLabel>
          <span className="text-xs text-muted-foreground">{(recipe.tools || []).join(", ") || "—"}</span>
        </Field>
      </div>
      <Field className="gap-1.5">
        <FieldLabel className="text-xs font-medium uppercase text-muted-foreground">{text.requiredContext}</FieldLabel>
        <p className="text-sm leading-6 text-muted-foreground">{recipe.requiredContext}</p>
      </Field>
    </div>
  );
}

function RecipeLaunchDialog({
  open,
  recipe,
  agents = [],
  defaultAgentId,
  runtime,
  workspaces = [],
  onOpenChange,
  onLaunch,
  copy = getLocaleCopy(DEFAULT_LOCALE),
}) {
  const text = recipeCopy(copy);
  const [agentId, setAgentId] = useState("");
  const [prompt, setPrompt] = useState("");

  const candidates = useMemo(() => {
    const online = agents.filter((agent) => !OFFLINE_MEMBER_STATUSES.has(agent.status));
    const pool = online.length ? online : agents;
    if (!recipe?.roleId) return pool;
    // Surface role-matching members first when the recipe is role-specific.
    return [...pool].sort((a, b) => {
      const aMatch = recipeAppliesToRole(recipe, agentRoleId(a)) && recipe.roleId === agentRoleId(a) ? 0 : 1;
      const bMatch = recipeAppliesToRole(recipe, agentRoleId(b)) && recipe.roleId === agentRoleId(b) ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [agents, recipe]);

  useEffect(() => {
    if (!open || !recipe) return;
    const roleMatch = candidates.find((agent) => recipe.roleId && recipe.roleId === agentRoleId(agent));
    setAgentId(defaultAgentId || roleMatch?.id || candidates[0]?.id || "");
    setPrompt("");
  }, [open, recipe, defaultAgentId]);

  if (!recipe) return null;
  const selectedAgent = agents.find((agent) => agent.id === agentId) || null;
  const workspace = selectedAgent ? getAgentWorkspace(selectedAgent, runtime, workspaces) : "";

  function submit(event) {
    event.preventDefault();
    if (!agentId) return;
    onLaunch?.({ recipe, agentId, prompt: prompt.trim() });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={copy.close} className="max-h-[88svh] overflow-y-auto rounded-md border-border bg-background p-0 sm:max-w-[640px]" data-testid="recipe-launch-preview">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="size-4" aria-hidden="true" />
            {recipe.name}
          </DialogTitle>
          <DialogDescription>{recipe.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="grid gap-5 p-6">
            <div className="text-xs font-medium uppercase text-muted-foreground">{text.previewTitle}</div>
            <RecipeMetaList recipe={recipe} copy={copy} />

            <Separator />

            <Field>
              <FieldLabel>{text.member}</FieldLabel>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder={text.selectMember} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{copy.mySquadMembers || "Squad members"}</SelectLabel>
                    {candidates.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name} / {localizedRole(agent, copy)}
                        {recipe.roleId && recipe.roleId === agentRoleId(agent) ? " / recommended" : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {workspace ? <FieldDescription>{text.scope}: {workspaceLabel(workspace, workspaces)}</FieldDescription> : null}
            </Field>

            <Field>
              <FieldLabel>{text.requiredContext}</FieldLabel>
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="min-h-24 resize-y"
                placeholder={recipe.requiredContext}
              />
            </Field>
          </div>
          <DialogFooter className="border-t px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange?.(false)}>
              {text.cancel}
            </Button>
            <Button type="submit" disabled={!agentId}>
              <Play data-icon="inline-start" />
              {text.launch}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecipeCatalogDialog({
  open,
  recipes = RECIPE_CATALOG,
  agents = [],
  defaultAgentId,
  runtime,
  workspaces = [],
  onOpenChange,
  onLaunch,
  copy = getLocaleCopy(DEFAULT_LOCALE),
}) {
  const text = recipeCopy(copy);
  const [selected, setSelected] = useState(null);

  function pick(recipe) {
    setSelected(recipe);
  }

  function handleLaunch(payload) {
    setSelected(null);
    onOpenChange?.(false);
    onLaunch?.(payload);
  }

  return (
    <>
      <Dialog open={open && !selected} onOpenChange={(next) => { if (!next) onOpenChange?.(false); }}>
        <DialogContent closeLabel={copy.close} className="max-h-[88svh] overflow-y-auto rounded-md border-border bg-background p-0 sm:max-w-[620px]" data-testid="recipe-catalog">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="size-4" aria-hidden="true" />
              {text.catalogTitle}
            </DialogTitle>
            <DialogDescription>{text.catalogDescription}</DialogDescription>
          </DialogHeader>
          <div className="divide-y">
            {recipes.map((recipe) => {
              const level = autonomyLadderLevelMeta(recipe.permissionLevel);
              const role = recipe.roleId ? roleTemplates.find((template) => template.id === recipe.roleId) : null;
              return (
                <button
                  key={recipe.id}
                  type="button"
                  onClick={() => pick(recipe)}
                  className="flex w-full flex-col items-start gap-1.5 px-6 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40"
                >
                  <div className="flex w-full flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{recipe.name}</span>
                    <Badge variant="outline" className="rounded-md text-[11px]">{level.shortLabel || level.label}</Badge>
                    {role ? (
                      <Badge variant="secondary" className="rounded-md text-[11px]">{formatCopy(text.forRole, { role: role.title })}</Badge>
                    ) : (
                      <Badge variant="secondary" className="rounded-md text-[11px]">{text.general}</Badge>
                    )}
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{recipe.description}</p>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
      <RecipeLaunchDialog
        open={Boolean(selected)}
        recipe={selected}
        agents={agents}
        defaultAgentId={defaultAgentId}
        runtime={runtime}
        workspaces={workspaces}
        onOpenChange={(next) => { if (!next) setSelected(null); }}
        onLaunch={handleLaunch}
        copy={copy}
      />
    </>
  );
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
  const selectedRecommendation = selectedTarget ? brainCardForAgent(selectedTarget).whyThisAgent : "";
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
              {selectedRecommendation ? (
                <div className="rounded-md border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
                  <span className="font-semibold text-foreground">Why this agent?</span> {selectedRecommendation}
                </div>
              ) : null}
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
  return [...CUSTOM_ROLE_SECTIONS, BRAIN_CARD_PROFILE_SECTION].find((section) => section.id === sectionId);
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
      "# Personality",
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

  if (sectionId === "brain-card") {
    return buildBrainCardProfileContent(agent);
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
  return [...CUSTOM_ROLE_SECTIONS, BRAIN_CARD_PROFILE_SECTION].map((section) => {
    if (section.id === "brain-card") {
      return {
        section: section.id,
        fileName: section.fileName,
        originalFileName: "",
        content: defaultProfileFileContent(agent, section.id),
        source: "generated",
      };
    }
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
    brainCard: brainCardForAgent(agent),
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
    brainCard: normalizeBrainCard(template.brainCard, template),
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
      brainCard: normalizeBrainCard(selectedTemplate.brainCard, selectedTemplate),
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
      brainCard: normalizeBrainCard(templateDraft.brainCard, {
        role: templateDraft.title,
        title: templateDraft.title,
        description,
        instructions: buildCustomRoleInstructions(templateDraft),
        skills: parseDelimitedList(templateDraft.skillsText),
      }),
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
      brainCard: normalizeBrainCard(customTemplate.brainCard, customTemplate),
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

  function updateBrainCardField(fieldId, value) {
    setDraft((current) => ({
      ...current,
      brainCard: { ...(current.brainCard || {}), [fieldId]: value },
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
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-muted-foreground">Brain card</h3>
                <Badge variant="secondary" className="border border-blue-500/50 bg-blue-500/10 text-blue-300">
                  JSON source
                </Badge>
              </div>
              <div className="mt-4 grid gap-4">
                {BRAIN_CARD_EDIT_FIELDS.map((field) => (
                  <Field key={field.id} className="gap-2">
                    <FieldLabel>{field.label}</FieldLabel>
                    <Textarea
                      value={draft.brainCard?.[field.id] || ""}
                      onChange={(event) => updateBrainCardField(field.id, event.target.value)}
                      placeholder={field.prompt}
                      className="min-h-[96px] resize-y bg-background leading-6"
                    />
                  </Field>
                ))}
              </div>
            </section>

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

  function updateBrainCardField(fieldId, value) {
    setDraft((current) => ({
      ...current,
      brainCard: { ...(current.brainCard || {}), [fieldId]: value },
    }));
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
      brainCard: normalizeBrainCard(draft.brainCard, { ...agent, role: draft.role.trim() || agent.role, description: draft.description, instructions: draft.instructions, skills }),
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
      brainCard: nextAgent.brainCard,
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

              <FieldSet className="rounded-md border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <FieldLabel className="text-base">Brain card</FieldLabel>
                  <Badge variant="secondary" className="border border-blue-500/50 bg-blue-500/10 text-blue-300">
                    JSON source
                  </Badge>
                </div>
                <FieldGroup className="mt-3 gap-4">
                  {BRAIN_CARD_EDIT_FIELDS.map((field) => (
                    <Field key={field.id} className="gap-2">
                      <FieldLabel>{field.label}</FieldLabel>
                      <Textarea
                        value={draft.brainCard?.[field.id] || ""}
                        onChange={(event) => updateBrainCardField(field.id, event.target.value)}
                        placeholder={field.prompt}
                        className="min-h-[92px] resize-y bg-background leading-6"
                      />
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>

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

function AgentModelPage({ agent, providerSettings, navigate, updateAgent }) {
  const currentAssignment = modelAssignmentForAgent(agent);
  const [draft, setDraft] = useState(currentAssignment);
  const definitions = providerDefinitionsFromSettings(providerSettings);
  const effectiveModel = effectiveModelForAgent({ ...agent, modelAssignment: draft }, providerSettings);
  const selectedProvider = draft.mode === "override" ? draft.provider : providerSettings?.defaultProvider || "openrouter";
  const configuredProviderIds = definitions.filter((definition) => providerIsConfigured(providerSettings, definition.id)).map((definition) => definition.id);
  const canSave = JSON.stringify(draft) !== JSON.stringify(currentAssignment);
  const overrideReady = draft.mode !== "override" || (providerIsConfigured(providerSettings, draft.provider) && Boolean(draft.model));

  useEffect(() => {
    setDraft(currentAssignment);
  }, [agent.id, agent.modelAssignment, agent.permissions]);

  function save() {
    if (!updateAgent || !overrideReady) return;
    updateAgent(agent.id, {
      modelAssignment: normalizeModelAssignment(draft),
      updatedAt: new Date().toISOString(),
    });
  }

  function selectMode(mode) {
    if (mode === "inherit") {
      setDraft({ mode: "inherit" });
      return;
    }
    const provider = configuredProviderIds.includes(selectedProvider) ? selectedProvider : configuredProviderIds[0] || selectedProvider;
    const model = providerSettings?.providers?.[provider]?.model || "";
    setDraft({ mode: "override", provider, model });
  }

  function selectProvider(provider) {
    const nextModel = providerSettings?.providers?.[provider]?.model || draft.model || "";
    setDraft({ mode: "override", provider, model: nextModel });
  }

  if (!providerSettings) {
    return (
      <div className="min-h-screen bg-background">
        <PageTitle title="Model" />
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-7 sm:px-6 lg:px-8">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-40 w-full rounded-md" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Model" />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-4 py-7 sm:px-6 lg:px-8">
        <header className="border-b border-border/70 pb-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
                <Brain className="size-4" />
                <span>{agent.name}</span>
              </div>
              <h2 className="text-3xl font-semibold tracking-normal">Model</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Choose whether this squad member inherits the workspace default or runs with its own provider and model.
              </p>
            </div>
            <Button variant="outline" onClick={() => navigate("/settings?section=providers")}>
              <Settings data-icon="inline-start" />
              LLM Providers
            </Button>
          </div>
        </header>

        <section className="grid gap-5 border-b border-border/70 pb-7 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <div className="text-sm font-medium">Effective model</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">This is the provider/model new runs will use after saving.</p>
          </div>
          <div className="grid gap-2">
            <div className="text-base font-semibold">{providerSummaryLabel(effectiveModel)}</div>
            <p className="text-sm text-muted-foreground">
              Source: {effectiveModel.source === "agent" ? "agent override" : "workspace default"}
              {effectiveModel.configured ? "" : " / provider is not fully configured"}
            </p>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <div className="text-sm font-medium">Assignment</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Overrides use provider and model together.</p>
          </div>
          <div className="grid gap-5">
            <ToggleGroup
              type="single"
              value={draft.mode}
              onValueChange={(value) => value && selectMode(value)}
              variant="outline"
              className="grid w-full grid-cols-2 sm:max-w-md"
            >
              <ToggleGroupItem value="inherit" className="justify-center">
                <Workflow data-icon="inline-start" />
                Inherit
              </ToggleGroupItem>
              <ToggleGroupItem value="override" className="justify-center">
                <Brain data-icon="inline-start" />
                Override
              </ToggleGroupItem>
            </ToggleGroup>

            {draft.mode === "override" ? (
              <div className="grid gap-4">
                <Field className="gap-2">
                  <FieldLabel>Provider</FieldLabel>
                  <Select value={draft.provider} onValueChange={selectProvider}>
                    <SelectTrigger className="h-10 w-full sm:max-w-md">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Configured providers</SelectLabel>
                        {definitions.map((definition) => {
                          const configured = providerIsConfigured(providerSettings, definition.id);
                          return (
                            <SelectItem key={definition.id} value={definition.id} disabled={!configured}>
                              {definition.label}{configured ? "" : " (configure in Settings)"}
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field className="gap-2">
                  <FieldLabel>Model ID</FieldLabel>
                  <Input
                    value={draft.model || ""}
                    onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                    placeholder={providerSettings?.providers?.[draft.provider]?.model || "Model ID"}
                    className="h-10 sm:max-w-md"
                  />
                  <FieldDescription>Use the exact model ID expected by the selected provider.</FieldDescription>
                </Field>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Inherits {providerSummaryLabel(effectiveModelForAgent({ modelAssignment: { mode: "inherit" } }, providerSettings))}.
              </p>
            )}

            {!overrideReady ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Override is not runnable</AlertTitle>
                <AlertDescription>Choose a configured provider and model, or switch this agent back to inherit.</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={save} disabled={!canSave || !overrideReady}>
                <CheckCircle2 data-icon="inline-start" />
                Save model assignment
              </Button>
              <Button type="button" variant="outline" disabled={!canSave} onClick={() => setDraft(currentAssignment)}>
                Discard
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SquadMemberSectionPage({
  agent,
  agents = [],
  section,
  tasks,
  automations,
  memoryInbox = [],
  runtime,
  workspaces,
  runs,
  providerSettings,
  navigate,
  openTerminal,
  updateAgent,
  saveMemoryProposalEdit,
  acceptMemoryProposal,
  rejectMemoryProposal,
  hideRejectedMemory,
  purgeHiddenRejectedMemory,
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
}) {
  const sectionMeta = MEMBER_SECTIONS.find((item) => item.id === section) || MEMBER_SECTIONS[0];
  const Icon = sectionMeta.icon;
  const sectionLabel = localizedSectionLabel(sectionMeta.id, copy);

  if (section === "permissions") {
    return (
      <AgentPermissionsPage
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

  if (section === "model") {
    return (
      <AgentModelPage
        agent={agent}
        providerSettings={providerSettings}
        navigate={navigate}
        updateAgent={updateAgent}
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

  if (section === "memory") {
    return (
      <MemoryInboxPage
        agent={agent}
        agents={agents}
        items={memoryInbox}
        locale={locale}
        copy={copy}
        navigate={navigate}
        openTerminal={openTerminal}
        onSaveEdit={saveMemoryProposalEdit}
        onAccept={acceptMemoryProposal}
        onReject={rejectMemoryProposal}
        onHideRejected={hideRejectedMemory}
        onPurgeHiddenRejected={purgeHiddenRejectedMemory}
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

function memoryStatusTone(status) {
  if (status === "accepted") return "border-primary/35 bg-primary/10 text-primary";
  if (status === "rejected") return "border-destructive/35 bg-destructive/10 text-destructive";
  return "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-200";
}

function memoryScopeLabel(scope) {
  return MEMORY_SCOPES.find((item) => item.id === scope)?.label || scope;
}

function memoryConfidenceLabel(confidence) {
  return `${Math.round((Number(confidence) || 0) * 100)}%`;
}

function memoryOwnerName(item, agents = []) {
  const owner = agents.find((agent) => agent.id === item.ownerAgentId);
  return owner?.name || item.ownerAgentId || "Squad member";
}

function memorySourceQualityWarning(item) {
  if (!item?.source?.id) {
    return "Source quality warning: this proposal has no source id, so keep confidence low until the source is attached.";
  }
  if (!item.evidence) {
    return "Source quality warning: this proposal has no supporting evidence yet.";
  }
  if (item.source?.type === "system" && Number(item.confidence) > 0.85) {
    return "Source quality warning: system-only proposals should be checked before using high confidence.";
  }
  return "";
}

function MemoryInboxPage({
  agent,
  agents = [],
  items = [],
  locale = DEFAULT_LOCALE,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  navigate,
  openTerminal,
  onSaveEdit,
  onAccept,
  onReject,
  onHideRejected,
  onPurgeHiddenRejected,
}) {
  const [showHiddenAudit, setShowHiddenAudit] = useState(false);
  const agentItems = items.filter((item) => item.ownerAgentId === agent.id || item.agentId === agent.id);
  const visibleItems = showHiddenAudit ? agentItems : agentItems.filter((item) => !item.isHidden);
  const pending = visibleItems.filter((item) => item.status === "pending");
  const accepted = visibleItems.filter((item) => item.status === "accepted");
  const rejected = visibleItems.filter((item) => item.status === "rejected");
  const hiddenRejectedCount = agentItems.filter((item) => item.status === "rejected" && item.isHidden).length;
  const activeMemory = Array.isArray(agent.memory) ? agent.memory : [];

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Memory" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <section className="border-b border-border/75 pb-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-11 place-items-center rounded-md border border-primary/35 bg-primary/15 text-primary">
                  <BrainCog className="size-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-2xl font-semibold tracking-normal">Memory Inbox</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {agent.name} / {localizedRole(agent, copy)} / reviewed before durable memory
                  </p>
                </div>
              </div>
              <p className="mt-5 max-w-3xl text-sm leading-6 text-muted-foreground">
                Proposed memories stay here until a person accepts them. Accepted records keep their source, confidence,
                timestamp, scope, and evidence; rejected records stay out of active memory.
              </p>
            </div>
            <div className="grid min-w-0 grid-cols-3 gap-3 sm:min-w-[420px]">
              <Metric label="Pending" value={formatLocalizedNumber(pending.length, locale)} />
              <Metric label="Accepted" value={formatLocalizedNumber(accepted.length, locale)} />
              <Metric label="Rejected" value={formatLocalizedNumber(rejected.length, locale)} />
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-6">
            <MemoryInboxSection
              title="Pending review"
              description="Accept, edit, reject, or change scope before this becomes durable memory."
              empty="No pending memory proposals for this member."
              items={pending}
              agents={agents}
              locale={locale}
              navigate={navigate}
              onSaveEdit={onSaveEdit}
              onAccept={onAccept}
              onReject={onReject}
            />
            <MemoryInboxSection
              title="Accepted memory"
              description="Durable memory with source evidence and review metadata."
              empty="No accepted memory records yet."
              items={accepted}
              agents={agents}
              locale={locale}
              navigate={navigate}
            />
            <section className="grid gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Rejected audit</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Rejected memories remain auditable locally and never enter active memory.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {hiddenRejectedCount ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowHiddenAudit((current) => !current)}>
                      {showHiddenAudit ? "Hide hidden" : `Show hidden (${hiddenRejectedCount})`}
                    </Button>
                  ) : null}
                  {hiddenRejectedCount ? (
                    <Button type="button" variant="outline" size="sm" onClick={onPurgeHiddenRejected}>
                      <Trash2 data-icon="inline-start" />
                      Purge hidden
                    </Button>
                  ) : null}
                </div>
              </div>
              {rejected.length ? (
                <div className="grid gap-3">
                  {rejected.map((item) => (
                    <MemoryProposalRow
                      key={item.id}
                      item={item}
                      agents={agents}
                      locale={locale}
                      navigate={navigate}
                      onHideRejected={onHideRejected}
                    />
                  ))}
                </div>
              ) : (
                <EmptyBlock icon={BrainCog} title="No rejected proposals" body="Rejected or hidden memory proposals will appear here for this session." />
              )}
            </section>
          </div>

          <aside className="grid h-fit gap-4 rounded-md border border-border/80 bg-card/75 p-4">
            <div>
              <h3 className="text-sm font-semibold">Active profile memory</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                These are the entries currently written into this member's generated MEMORY.md profile context.
              </p>
            </div>
            <div className="grid max-h-[420px] gap-2 overflow-auto pr-1">
              {activeMemory.length ? (
                activeMemory.map((memory) => (
                  <div key={memory} className="rounded-md border border-border/80 bg-background/65 p-3">
                    <div className="text-sm leading-5">{memory}</div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No active memory yet.</p>
              )}
            </div>
            <Separator />
            <Button variant="outline" onClick={() => openTerminal(agent)}>
              <TerminalSquare data-icon="inline-start" />
              {copy.openCli}
            </Button>
            <Button onClick={() => navigate(memberProfilePath(agent.id, "home"))}>{copy.home}</Button>
          </aside>
        </section>
      </div>
    </div>
  );
}

function MemoryInboxSection({ title, description, empty, items, agents, locale, navigate, onSaveEdit, onAccept, onReject }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {items.length ? (
        <div className="grid gap-3">
          {items.map((item) => (
            <MemoryProposalRow
              key={item.id}
              item={item}
              agents={agents}
              locale={locale}
              navigate={navigate}
              onSaveEdit={onSaveEdit}
              onAccept={onAccept}
              onReject={onReject}
            />
          ))}
        </div>
      ) : (
        <EmptyBlock icon={BrainCog} title={empty} body="New proposed memories will wait here for review." />
      )}
    </section>
  );
}

function MemoryProposalRow({ item, agents = [], locale = DEFAULT_LOCALE, navigate, onSaveEdit, onAccept, onReject, onHideRejected }) {
  const [draftContent, setDraftContent] = useState(item.content);
  const [draftConfidence, setDraftConfidence] = useState(String(Math.round((Number(item.confidence) || 0) * 100)));
  const [rejectReason, setRejectReason] = useState(item.rejectReason || "");
  const sourceHref = memorySourceHref(item);
  const canEdit = item.status === "pending" && Boolean(onSaveEdit);
  const hasBeforeAfter = item.originalContent && item.originalContent !== item.content;
  const sourceWarning = memorySourceQualityWarning(item);

  useEffect(() => {
    setDraftContent(item.content);
    setDraftConfidence(String(Math.round((Number(item.confidence) || 0) * 100)));
    setRejectReason(item.rejectReason || "");
  }, [item.confidence, item.content, item.id, item.rejectReason]);

  function saveEdit() {
    const confidence = Number(draftConfidence);
    onSaveEdit?.(item.id, {
      content: draftContent,
      scope: item.scope,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) / 100 : item.confidence,
    });
  }

  function changeScope(scope) {
    onSaveEdit?.(item.id, { scope });
  }

  return (
    <article className={cn("rounded-md border border-border/80 bg-card/75 p-4", item.isHidden && "opacity-70")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn("rounded-md capitalize", memoryStatusTone(item.status))}>
              {item.status}
            </Badge>
            <Badge variant="secondary" className="rounded-md bg-muted text-muted-foreground">
              {memoryScopeLabel(item.scope)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Confidence {memoryConfidenceLabel(item.confidence)}
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Owner: {memoryOwnerName(item, agents)} / Updated {formatRecordDate(item.updatedAt, locale)}
          </div>
          {item.scope === "project" && item.projectKey ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">
              Project: {item.projectLabel || workspaceName(item.projectKey)} / {item.projectKey}
            </div>
          ) : null}
        </div>
        <MissionAnchor
          href={sourceHref}
          navigate={navigate}
          className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm text-primary transition-colors hover:bg-primary/10"
        >
          <ArrowUpRight className="size-4" />
          {item.source?.label || "Source"}
        </MissionAnchor>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {canEdit ? (
            <Textarea
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              className="min-h-24 resize-y bg-background leading-6"
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-6">{item.content}</p>
          )}
          {hasBeforeAfter ? (
            <div className="mt-3 grid gap-2 rounded-md border border-border/70 bg-background/55 p-3 text-sm">
              <div>
                <div className="text-[11px] font-medium uppercase text-muted-foreground">Before edit</div>
                <p className="mt-1 text-muted-foreground">{item.originalContent}</p>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase text-muted-foreground">After edit</div>
                <p className="mt-1">{item.content}</p>
              </div>
            </div>
          ) : null}
          <div className="mt-3 text-sm leading-6 text-muted-foreground">
            <span className="font-semibold text-foreground">Evidence:</span> {item.evidence || "No evidence recorded."}
          </div>
          {item.confidenceRationale ? (
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              <span className="font-semibold text-foreground">Rationale:</span> {item.confidenceRationale}
            </div>
          ) : null}
          {sourceWarning ? (
            <div className="mt-2 rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm leading-6 text-amber-900 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-200">
              {sourceWarning}
            </div>
          ) : null}
          {item.rejectReason ? (
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              <span className="font-semibold text-foreground">Rejection reason:</span> {item.rejectReason}
            </div>
          ) : null}
        </div>

        <div className="grid content-start gap-3">
          {canEdit ? (
            <>
              <Field className="gap-2">
                <FieldLabel>Scope</FieldLabel>
                <Select value={item.scope} onValueChange={changeScope}>
                  <SelectTrigger className="h-9 w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Memory scope</SelectLabel>
                      {MEMORY_SCOPES.map((scope) => (
                        <SelectItem key={scope.id} value={scope.id}>
                          {scope.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{MEMORY_SCOPES.find((scope) => scope.id === item.scope)?.detail}</FieldDescription>
              </Field>
              <Field className="gap-2">
                <FieldLabel>Confidence</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={draftConfidence}
                    onChange={(event) => setDraftConfidence(event.target.value)}
                    className="h-9 bg-background"
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">%</span>
                </div>
                <FieldDescription>User-reviewed confidence for the accepted memory record.</FieldDescription>
              </Field>
              <Button type="button" variant="outline" onClick={saveEdit}>
                <PencilLine data-icon="inline-start" />
                Edit
              </Button>
              <Button type="button" onClick={() => onAccept?.(item.id)}>
                <BadgeCheck data-icon="inline-start" />
                Accept
              </Button>
              <Field className="gap-2">
                <FieldLabel>Reject reason</FieldLabel>
                <Input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Optional audit note" />
              </Field>
              <Button type="button" variant="outline" onClick={() => onReject?.(item.id, rejectReason)}>
                <Ban data-icon="inline-start" />
                Reject
              </Button>
            </>
          ) : item.status === "rejected" ? (
            <Button type="button" variant="outline" onClick={() => onHideRejected?.(item.id)} disabled={item.isHidden}>
              <X data-icon="inline-start" />
              {item.isHidden ? "Hidden from default view" : "Hide"}
            </Button>
          ) : (
            <div className="rounded-md border border-border/70 bg-background/55 p-3 text-xs leading-5 text-muted-foreground">
              Accepted {formatRecordDate(item.acceptedAt || item.updatedAt, locale)} as {memoryScopeLabel(item.scope).toLowerCase()} memory.
            </div>
          )}
        </div>
      </div>
    </article>
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

function AgentPermissionsPage({ agent, runtime, workspaces = [], navigate, openTerminal, updateAgent, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const defaultPermissionWorkspace = getAgentWorkspace(agent, runtime, workspaces);
  const [selectedWorkspace, setSelectedWorkspace] = useState(defaultPermissionWorkspace);
  const permissions = resolveAgentPermissionsForWorkspace(agent, selectedWorkspace || defaultPermissionWorkspace);
  const activeLadder = autonomyLadderLevelMeta(permissions.ladderLevel);
  const [activeTab, setActiveTab] = useState("ladder");
  const [sensitivePathDraft, setSensitivePathDraft] = useState("");
  const projectChoices = normalizeAgentProjects(agent.projects, agent.workspace, workspaces, configuredProjectLimit(runtime));
  const permissionWorkspaceChoices = useMemo(() => {
    const choices = [...projectChoices, ...workspaceOptions(workspaces, selectedWorkspace || defaultPermissionWorkspace, runtime)]
      .map((item) => projectRecordFromPath(item, workspaces))
      .filter((item) => item && !isBlockedWorkspace(item.path, runtime));
    const seen = new Set();
    return choices.filter((item) => {
      if (seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    });
  }, [defaultPermissionWorkspace, projectChoices, runtime, selectedWorkspace, workspaces]);
  const policyModes = [
    ...CLI_TOOL_PERMISSIONS.map((item) => permissions.modes[item.id]),
    ...Object.values(permissions.builtInPolicies),
  ];
  const allowedCount = policyModes.filter((mode) => mode === "allow").length;
  const askCount = policyModes.filter((mode) => mode === "ask").length;
  const blockedCount = policyModes.filter((mode) => mode === "block").length;
  const autonomyScore = Math.round(((allowedCount * 2 + askCount) / (policyModes.length * 2)) * 100);
  const workspaceOverrideCount = permissionOverrideCount(agent.permissions);

  useEffect(() => {
    const normalizedWorkspace = normalizeSquadWorkspacePath(selectedWorkspace, runtime);
    if (normalizedWorkspace && normalizedWorkspace !== selectedWorkspace) {
      setSelectedWorkspace(normalizedWorkspace);
      return;
    }
    if (!normalizedWorkspace || isBlockedWorkspace(normalizedWorkspace, runtime)) {
      setSelectedWorkspace(defaultPermissionWorkspace);
    }
  }, [agent.id, defaultPermissionWorkspace, runtime, selectedWorkspace]);

  function updatePermissions(patch) {
    if (!updateAgent) return;
    const nextPermissions = normalizePermissionState({ ...permissions, ...patch }, { includeWorkspaceOverrides: false });
    updateAgent(agent.id, {
      permissions: permissionOverrideForWorkspace(agent.permissions, selectedWorkspace || defaultPermissionWorkspace, nextPermissions),
      updatedAt: new Date().toISOString(),
    });
  }

  function updateLadderLevel(ladderLevel) {
    if (!updateAgent) return;
    const level = autonomyLadderLevelMeta(ladderLevel);
    const nextPermissions = normalizePermissionState(
      {
        ...permissions,
        ...permissionPresetForAutonomyLadder(level.id),
        sensitivePaths: permissions.sensitivePaths,
        modelSecurity: permissions.modelSecurity,
        modelSecurityEnabled: permissions.modelSecurityEnabled,
      },
      { includeWorkspaceOverrides: false }
    );
    updateAgent(agent.id, {
      launch: { ...agent.launch, policy: level.launchPolicy },
      permissions: permissionOverrideForWorkspace(agent.permissions, selectedWorkspace || defaultPermissionWorkspace, nextPermissions),
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
    const nextPermissions = normalizePermissionState({ ...permissions, permissionMode }, { includeWorkspaceOverrides: false });
    updateAgent(agent.id, {
      launch: { ...agent.launch, policy: launchPolicy },
      permissions: permissionOverrideForWorkspace(agent.permissions, selectedWorkspace || defaultPermissionWorkspace, nextPermissions),
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
                    {agent.name} / {localizedRole(agent, copy)} / {workspaceName(selectedWorkspace) || "workspace"}
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
                  <div className="mt-1 text-xs text-muted-foreground">
                    Level {activeLadder.rank}: {activeLadder.label} / {autonomyScore}% coverage
                  </div>
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
              value={workspaceName(selectedWorkspace) || "selected"}
              detail={selectedWorkspace || "No workspace selected"}
            />
          </div>
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-md border bg-card/75 p-1 lg:max-w-4xl lg:grid-cols-5">
            {PERMISSION_TABS.map((tabItem) => (
              <TabsTrigger key={tabItem.id} value={tabItem.id} className="h-10 rounded-[6px] px-3 text-sm">
                {tabItem.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="ladder" className="m-0 mt-5">
            <div className="flex flex-col gap-5">
              <PermissionLadderPanel
                permissions={permissions}
                selectedWorkspace={selectedWorkspace}
                workspaceChoices={permissionWorkspaceChoices}
                workspaceOverrideCount={workspaceOverrideCount}
                onWorkspaceChange={setSelectedWorkspace}
                onLadderChange={updateLadderLevel}
              />
              <PermissionRunExamplePanel permissions={permissions} />
              <div className="grid gap-5">
                {CLI_PERMISSION_GROUPS.map((group) => (
                  <PermissionToolGroup
                    key={group.id}
                    group={group}
                    modes={permissions.modes}
                    onModeChange={updateToolMode}
                  />
                ))}
              </div>
            </div>
          </TabsContent>

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

function PermissionLadderPanel({
  permissions,
  selectedWorkspace,
  workspaceChoices = [],
  workspaceOverrideCount = 0,
  onWorkspaceChange,
  onLadderChange,
}) {
  const activeLevel = autonomyLadderLevelMeta(permissions.ladderLevel);
  const ActiveIcon = activeLevel.icon;
  const selectedWorkspaceValue = workspaceChoices.some((workspace) => workspace.path === selectedWorkspace)
    ? selectedWorkspace
    : undefined;

  return (
    <section className="rounded-md border border-border/80 bg-card/75 p-5 lg:p-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-11 place-items-center rounded-md border border-primary/35 bg-primary/15 text-primary">
              <ActiveIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-xl font-semibold tracking-normal">Permission ladder</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Level {activeLevel.rank}: {activeLevel.label}. The ladder summarizes the exact tool matrix below; changing it updates the low-level policies for this workspace.
              </p>
            </div>
          </div>

          <ToggleGroup
            type="single"
            value={activeLevel.id}
            onValueChange={(value) => value && onLadderChange(value)}
            variant="outline"
            className="mt-5 grid w-full grid-cols-2 items-stretch sm:grid-cols-3 xl:grid-cols-6"
            spacing={0}
          >
            {AUTONOMY_LADDER_LEVELS.map((level) => {
              const Icon = level.icon;
              return (
                <ToggleGroupItem
                  key={level.id}
                  value={level.id}
                  aria-label={`Level ${level.rank}: ${level.label}`}
                  className="h-auto min-h-20 flex-col items-start justify-start gap-2 px-3 py-3 text-left"
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-[11px] font-medium uppercase text-muted-foreground">L{level.rank}</span>
                    <Icon className="size-3.5" />
                  </span>
                  <span className="w-full text-wrap text-sm font-semibold leading-4">{level.shortLabel}</span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>

        <div className="rounded-md border border-border/80 bg-background/65 p-4">
          <div className="text-sm font-semibold">Workspace policy</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Overrides are stored locally per squad member and normalized repository path.
          </p>
          <Select value={selectedWorkspaceValue} onValueChange={onWorkspaceChange} disabled={!workspaceChoices.length}>
            <SelectTrigger className="mt-4 h-10 w-full bg-background">
              <FolderGit2 className="size-4 text-muted-foreground" />
              <SelectValue placeholder={workspaceName(selectedWorkspace) || "Select workspace"} />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-[420px]">
              <SelectGroup>
                <SelectLabel>Workspace</SelectLabel>
                {workspaceChoices.map((workspace) => (
                  <SelectItem key={workspace.path} value={workspace.path}>
                    {workspace.label || workspaceName(workspace.path)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {workspaceOverrideCount} workspace override{workspaceOverrideCount === 1 ? "" : "s"} saved for this member.
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-5 border-t border-border/75 pt-5 lg:grid-cols-3">
        <PermissionCapabilityColumn title="Available now" items={activeLevel.available} tone="text-primary" />
        <PermissionCapabilityColumn title="Asks first" items={activeLevel.approvals} tone="text-amber-700 dark:text-amber-200" />
        <PermissionCapabilityColumn title="Blocked" items={activeLevel.blocked} tone="text-red-700 dark:text-red-200" />
      </div>
    </section>
  );
}

function PermissionCapabilityColumn({ title, items = [], tone }) {
  return (
    <div className="min-w-0">
      <div className={cn("text-xs font-semibold uppercase", tone)}>{title}</div>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <div key={item} className="flex min-w-0 items-start gap-2 text-sm leading-5 text-muted-foreground">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
            <span className="min-w-0 text-wrap">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function permissionRunExamples(permissions) {
  const ladder = autonomyLadderLevelMeta(permissions.ladderLevel);
  const destructiveMode = permissions.modes["shell.destructive"] || "block";
  const prMode = permissions.modes["github.remote"] || "block";
  const mergeMode = permissions.builtInPolicies.git_merge || "block";
  return [
    {
      id: "destructive",
      title: "Blocked destructive command",
      command: "rm -rf .git",
      mode: destructiveMode,
      detail: `Level ${ladder.rank} keeps shell.destructive ${destructiveMode}. Disk wipes, privilege escalation, and recursive deletion do not run automatically.`,
    },
    {
      id: "approval",
      title: "Approval prompt above current level",
      command: "Open a draft PR on GitHub",
      mode: prMode,
      detail: PR_READY_LADDER_LEVELS.has(ladder.id)
        ? "GitHub and push actions ask first, and require connector readiness before a draft PR can be created."
        : "Raise the ladder to Open PR before the member can request GitHub or push approval.",
    },
    {
      id: "merge",
      title: "Auto-merge guard",
      command: "Merge PR after checks pass",
      mode: mergeMode,
      detail: "Auto-merge stays blocked at every ladder level; the user keeps merge authority.",
    },
  ];
}

function PermissionRunExamplePanel({ permissions }) {
  return (
    <section className="rounded-md border border-border/80 bg-card/75 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Run warnings</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            These examples show what happens before a run crosses the current ladder boundary.
          </p>
        </div>
        <Badge variant="outline" className="rounded-md bg-background">
          auto-merge off
        </Badge>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {permissionRunExamples(permissions).map((example) => (
          <div key={example.id} className="rounded-md border border-border/80 bg-background/65 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">{example.title}</div>
              <PermissionModeBadge mode={example.mode} />
            </div>
            <code className="mt-3 block truncate rounded-md bg-muted/45 px-3 py-2 font-mono text-xs text-muted-foreground">
              {example.command}
            </code>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{example.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PermissionModeBadge({ mode }) {
  const meta = permissionLevelMeta(mode);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium", meta.tone)}>
      <span className={cn("size-1.5 rounded-full", meta.indicator)} aria-hidden="true" />
      {meta.label}
    </span>
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

function brainCardPreviewLines(value, limit = 4) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function permissionSummary(agent, workspace = agent?.workspace) {
  const permissions = resolveAgentPermissionsForWorkspace(agent, workspace);
  const ladder = autonomyLadderLevelMeta(permissions.ladderLevel);
  const policyEntries = Object.entries(permissions.builtInPolicies || {});
  const allowCount = policyEntries.filter(([, mode]) => mode === "allow").length;
  const blockCount = policyEntries.filter(([, mode]) => mode === "block").length;
  return `Level ${ladder.rank}: ${ladder.label}, ${allowCount} autonomous tools, ${blockCount} blocked`;
}

function capabilityLevel(agent) {
  const skillCount = normalizeSkillList(agent?.skills).length;
  const toolCount = Array.isArray(agent?.tools) ? agent.tools.length : 0;
  if (skillCount >= 4 && toolCount >= 3) return "Specialist with installed skills";
  if (skillCount >= 2) return "Configured role specialist";
  return "General squad member";
}

function connectorReadiness(agent) {
  const tools = Array.isArray(agent?.tools) ? agent.tools : [];
  const readyTools = tools.filter((tool) => ["ready", "wired", "isolated"].includes(String(tool?.status || "").toLowerCase()));
  if (!tools.length) return "No connector tools configured";
  return `${readyTools.length}/${tools.length} local tools ready`;
}

function toolCategorySummary(agent) {
  const brainCard = brainCardForAgent(agent);
  const fromBrainCard = brainCardPreviewLines(brainCard.allowedTools, 3).map((line) => line.replace(/^[-\d.]+\s*/, ""));
  if (fromBrainCard.length) return fromBrainCard.join("; ");
  const tools = Array.isArray(agent?.tools) ? agent.tools.map((tool) => tool.name).filter(Boolean) : [];
  return tools.length ? tools.join(", ") : "Autohand CLI and installed profile skills";
}

function buildAgentIdCardText(agent) {
  const brainCard = brainCardForAgent(agent);
  return [
    `Autohand Squad ID Card: ${agent?.name || "Squad member"}`,
    `Agent ID: ${agent?.id || "unknown"}`,
    agent?.staffId ? `Staff ID: ${agent.staffId}` : "",
    `Role: ${agent?.role || "Software engineering agent"}`,
    `Capability level: ${capabilityLevel(agent)}`,
    `Permission summary: ${permissionSummary(agent, agent?.workspace)}`,
    `Tool categories: ${toolCategorySummary(agent)}`,
    `Connector readiness: ${connectorReadiness(agent)}`,
    `Memory policy: ${brainCard.memoryPolicy}`,
    `Why this agent?: ${brainCard.whyThisAgent}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function BrainCardFieldBlock({ field, value }) {
  const lines = brainCardPreviewLines(value, 12);
  return (
    <section className="rounded-md border bg-background/55 p-4">
      <h4 className="text-sm font-semibold text-foreground">{field.label}</h4>
      <div className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
        {lines.length ? (
          lines.map((line, index) => (
            <p key={`${field.id}-${index}`} className="whitespace-pre-wrap">
              {line}
            </p>
          ))
        ) : (
          <p>Not configured.</p>
        )}
      </div>
    </section>
  );
}

function CompactAgentIdCard({ agent }) {
  const [copied, setCopied] = useState(false);
  const brainCard = brainCardForAgent(agent);
  const rows = [
    { label: "Capability", value: capabilityLevel(agent) },
    { label: "Autonomy", value: permissionSummary(agent, agent?.workspace) },
    { label: "Tool categories", value: toolCategorySummary(agent) },
    { label: "Connectors", value: connectorReadiness(agent) },
  ];

  async function copyIdCard() {
    const text = buildAgentIdCardText(agent);
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="rounded-md border bg-muted/20 p-4">
      <div className="flex items-start gap-3">
        <AgentAvatar agent={agent} className="size-11" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{agent.name}</div>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{agent.staffId || agent.id}</div>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-md bg-background/70 p-3">
            <div className="text-[11px] font-medium uppercase text-muted-foreground">{row.label}</div>
            <div className="mt-1 text-sm leading-5">{row.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-md bg-background/70 p-3">
        <div className="text-[11px] font-medium uppercase text-muted-foreground">Memory policy</div>
        <p className="mt-1 max-h-28 overflow-auto text-sm leading-5 text-muted-foreground">{brainCard.memoryPolicy}</p>
      </div>
      <Button type="button" variant="outline" size="sm" className="mt-4 w-full" onClick={copyIdCard}>
        <ClipboardCheck data-icon="inline-start" />
        {copied ? "Copied" : "Copy ID card"}
      </Button>
    </aside>
  );
}

function ProfilePermissionLadder({ agent, runtime, workspaces = [], navigate, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const workspace = getAgentWorkspace(agent, runtime, workspaces);
  const permissions = resolveAgentPermissionsForWorkspace(agent, workspace);
  const activeLevel = autonomyLadderLevelMeta(permissions.ladderLevel);
  const warnings = permissionWarningsForAgent(agent, runtime, workspace);

  return (
    <section className="border-y border-border/75 py-5" aria-labelledby="profile-permission-ladder">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="profile-permission-ladder" className="text-base font-semibold">Permission ladder</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Level {activeLevel.rank}: {activeLevel.label} for {workspaceName(workspace) || "selected workspace"}.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate(memberProfilePath(agent.id, "permissions"))}>
          <ShieldAlert data-icon="inline-start" />
          Permission
        </Button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {AUTONOMY_LADDER_LEVELS.map((level) => {
          const selected = level.id === activeLevel.id;
          return (
            <div
              key={level.id}
              className={cn(
                "min-h-16 rounded-md border px-3 py-2",
                selected ? "border-primary/45 bg-primary/10 text-foreground" : "border-border/70 bg-muted/20 text-muted-foreground"
              )}
            >
              <div className="text-[11px] font-medium uppercase">Level {level.rank}</div>
              <div className="mt-1 text-sm font-semibold leading-4">{level.label}</div>
            </div>
          );
        })}
      </div>
      {warnings.length ? (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{warnings[0].message}</span>
        </div>
      ) : null}
    </section>
  );
}

function BrainCardPanel({ agent, onEdit }) {
  const brainCard = brainCardForAgent(agent);
  return (
    <Card className="rounded-md border-border/80 bg-card/75 shadow-none" id="brain-card">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Brain className="size-5 text-primary" />
            <CardTitle>Brain card</CardTitle>
          </div>
          <CardDescription className="mt-2">{brainCard.whyThisAgent}</CardDescription>
        </div>
        <CardAction>
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            <PencilLine data-icon="inline-start" />
            Edit
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid gap-3 md:grid-cols-2">
          {brainCardFields.map((field) => (
            <BrainCardFieldBlock key={field.id} field={field} value={brainCard[field.id]} />
          ))}
        </div>
        <CompactAgentIdCard agent={agent} />
      </CardContent>
    </Card>
  );
}

function ProfileModelSummary({ agent, providerSettings, navigate }) {
  const effectiveModel = effectiveModelForAgent(agent, providerSettings);
  return (
    <section className="border-b border-border/75 pb-5" aria-labelledby="profile-model-summary">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="profile-model-summary" className="text-base font-semibold">Model</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {providerSummaryLabel(effectiveModel)} / {effectiveModel.source === "agent" ? "agent override" : "workspace default"}
            {effectiveModel.configured ? "" : " / not fully configured"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate(memberProfilePath(agent.id, "model"))}>
          <Brain data-icon="inline-start" />
          Model
        </Button>
      </div>
    </section>
  );
}

function Profile({ agent, agents = [], tasks, automations, runtime, workspaces = [], runs, providerSettings, navigate, openTerminal, updateAgent, startAutohand, initialWorkRecordTab = "timeline", locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  const activity = useMemo(() => buildActivity(), []);
  const [workRecordTab, setWorkRecordTab] = useState(initialWorkRecordTab);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  // Goal 09: recipe launch from the member profile.
  const [profileRecipeTarget, setProfileRecipeTarget] = useState(null);

  useEffect(() => {
    setWorkRecordTab(initialWorkRecordTab);
  }, [agent.id, initialWorkRecordTab]);

  function launchProfileRecipe({ recipe, agentId, prompt }) {
    if (!recipe || !startAutohand) return;
    setProfileRecipeTarget(null);
    startAutohand(agentId || agent.id, {
      recipeId: recipe.id,
      prompt: String(prompt || "").trim() || `Run recipe "${recipe.name}": ${recipe.description}`,
      workspace: getAgentWorkspace(agent, runtime, workspaces),
      mode: "goal",
      dryRun: false,
    });
    navigate(memberChatPath(agent.id));
  }

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

        <ProfilePermissionLadder agent={agent} runtime={runtime} workspaces={workspaces} navigate={navigate} copy={copy} />

        <ProfileModelSummary agent={agent} providerSettings={providerSettings} navigate={navigate} />

        <BrainCardPanel agent={agent} onEdit={() => setProfileEditOpen(true)} />

        {startAutohand ? (
          <ProfileRecipes agent={agent} copy={copy} onLaunch={(recipe) => setProfileRecipeTarget(recipe)} />
        ) : null}

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

      <RecipeLaunchDialog
        open={Boolean(profileRecipeTarget)}
        recipe={profileRecipeTarget}
        agents={agents.length ? agents : [agent]}
        defaultAgentId={agent.id}
        runtime={runtime}
        workspaces={workspaces}
        onOpenChange={(next) => { if (!next) setProfileRecipeTarget(null); }}
        onLaunch={launchProfileRecipe}
        copy={copy}
      />
    </div>
  );
}

// Goal 09: Recipes section on the member profile — lists the recipes that apply
// to this member's role (role-specific first, then general) with a launch
// action. Kept as a calm divider-separated list, not a card wall.
function ProfileRecipes({ agent, copy = getLocaleCopy(DEFAULT_LOCALE), onLaunch }) {
  const text = recipeCopy(copy);
  const recipes = useMemo(() => recommendedRecipes(agent), [agent]);
  if (!recipes.length) return null;
  return (
    <section className="border-b border-border/70 pb-5" aria-labelledby="profile-recipes-title">
      <div className="mb-1 flex items-center gap-2">
        <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id="profile-recipes-title" className="text-lg font-semibold">{text.sectionTitle}</h3>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{formatCopy(text.sectionDescription, { name: agent.name })}</p>
      <ul className="divide-y divide-border/60">
        {recipes.map((recipe) => {
          const level = autonomyLadderLevelMeta(recipe.permissionLevel);
          return (
            <li key={recipe.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{recipe.name}</span>
                  <Badge variant="outline" className="rounded-md text-[11px]">{level.shortLabel || level.label}</Badge>
                  <Badge variant="secondary" className="rounded-md text-[11px]">{recipe.roleId ? text.roleSpecific : text.general}</Badge>
                </div>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{recipe.description}</p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => onLaunch?.(recipe)}>
                <Play data-icon="inline-start" />
                {text.launchRecipe}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
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

function AboutDialog({ open, runtime, onOpenChange, onGiveFeedback }) {
  const squadVersion = runtime?.squadVersion || "0.1.0";
  const runtimeVersion = runtime?.version || "Runtime not detected";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="Close" className="max-h-[88svh] overflow-y-auto rounded-md border-border bg-background p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b px-6 py-5 text-left">
          <div className="mb-3 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
              <Bot className="size-5" aria-hidden="true" />
            </span>
            <div>
              <DialogTitle className="text-2xl">Autohand Squad</DialogTitle>
              <DialogDescription>Local-first desktop controller for your Autohand Code Squad.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid gap-5 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <AboutFact label="Squad version" value={squadVersion} />
            <AboutFact label="CLI runtime" value={runtimeVersion} />
            <AboutFact label="Bridge" value={runtime?.available ? "Connected" : "Offline"} />
            <AboutFact label="Workspace root" value={runtime?.workspaceRoot || "User directory"} />
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Copyright (c) 2026 Autohand AI LLC. All rights reserved.
          </p>
        </div>
        <DialogFooter className="border-t bg-background px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>
            Close
          </Button>
          <Button onClick={onGiveFeedback}>
            <MessageSquareText data-icon="inline-start" />
            Give Feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FloatingFeedbackButton({ onReportBug, onGiveFeedback }) {
  const [open, setOpen] = useState(false);

  function choose(action) {
    setOpen(false);
    action?.();
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 sm:bottom-5 sm:right-5">
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="icon-lg"
                className="border border-border/80 bg-background text-foreground shadow-lg hover:bg-accent hover:text-accent-foreground"
                aria-label="Report bug or give feedback"
              >
                <MessageSquareText className="size-5" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">Report bug or give feedback</TooltipContent>
        </Tooltip>
        <PopoverContent side="top" align="end" className="w-64 p-2">
          <div className="grid gap-1">
            <Button
              type="button"
              variant="ghost"
              className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
              onClick={() => choose(onReportBug)}
            >
              <Bug className="size-4" aria-hidden="true" />
              <span className="grid gap-0.5">
                <span>Report Bug</span>
                <span className="text-xs font-normal text-muted-foreground">Capture this view with diagnostics.</span>
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
              onClick={() => choose(onGiveFeedback)}
            >
              <MessageSquareText className="size-4" aria-hidden="true" />
              <span className="grid gap-0.5">
                <span>Give Feedback</span>
                <span className="text-xs font-normal text-muted-foreground">Share what worked or what felt rough.</span>
              </span>
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function AboutFact({ label, value }) {
  return (
    <div className="min-w-0 border-t border-border/70 pt-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function FeedbackDialog({ kind = "feedback", open, route, onOpenChange }) {
  const [rating, setRating] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [captureState, setCaptureState] = useState("idle");
  const [submitState, setSubmitState] = useState("idle");
  const [error, setError] = useState("");
  const isBug = kind === "bug";
  const title = isBug ? "Report Bug" : "Give Feedback";
  const canSubmit = submitState !== "submitting" && (Boolean(rating) || Boolean(description.trim()));

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setRating("");
    setDescription("");
    setEmail("");
    setScreenshot(null);
    setDiagnostics(null);
    setIncludeScreenshot(true);
    setIncludeDiagnostics(true);
    setCaptureState("loading");
    setSubmitState("idle");
    setError("");

    api("/api/feedback/screenshot", {
      method: "POST",
      body: JSON.stringify({
        route,
        storage: collectFeedbackStorageSnapshot(),
      }),
    })
      .then((data) => {
        if (cancelled) return;
        setScreenshot(data?.screenshot || { available: false, error: "Screenshot unavailable." });
        setDiagnostics(data?.diagnostics || null);
        setCaptureState("ready");
      })
      .catch((captureError) => {
        if (cancelled) return;
        setScreenshot({ available: false, error: captureError.message || "Screenshot unavailable." });
        setCaptureState("ready");
      });

    return () => {
      cancelled = true;
    };
  }, [kind, open, route]);

  async function submitFeedback(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitState("submitting");
    setError("");
    try {
      await api("/api/feedback/squad", {
        method: "POST",
        body: JSON.stringify({
          kind,
          rating: rating ? Number(rating) : null,
          description,
          userEmail: email,
          allowContact: Boolean(email.trim()),
          route,
          includeScreenshot,
          includeDiagnostics,
          screenshot: includeScreenshot ? screenshot : null,
        }),
      });
      setSubmitState("submitted");
    } catch (submitError) {
      setError(submitError.message || "Feedback could not be sent.");
      setSubmitState("idle");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="Close" className="max-h-[92svh] overflow-y-auto rounded-md border-border bg-background p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-6 py-5 text-left">
          <div className="mb-3 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-md bg-muted text-foreground">
              {isBug ? <Bug className="size-5" aria-hidden="true" /> : <MessageSquareText className="size-5" aria-hidden="true" />}
            </span>
            <div>
              <DialogTitle className="text-2xl">{title}</DialogTitle>
              <DialogDescription>{route}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {submitState === "submitted" ? (
          <div className="px-6 py-8">
            <div className="mx-auto max-w-md text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-md bg-primary text-primary-foreground">
                <CheckCircle2 className="size-6" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-xl font-semibold">Thanks for helping improve Squad.</h3>
              <p className="mt-2 text-sm text-muted-foreground">Your feedback was sent with the context you approved.</p>
              <Button className="mt-6" onClick={() => onOpenChange?.(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submitFeedback}>
            <div className="grid gap-6 px-6 py-5">
              <Field className="gap-3">
                <FieldLabel>How would you rate your experience here today?</FieldLabel>
                <ToggleGroup
                  type="single"
                  value={rating}
                  onValueChange={(value) => value && setRating(value)}
                  variant="outline"
                  className="grid w-full grid-cols-5"
                  aria-label="Rate your experience"
                >
                  {["1", "2", "3", "4", "5"].map((value) => (
                    <ToggleGroupItem key={value} value={value} className="justify-center">
                      {value}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>

              <Field className="gap-2">
                <FieldLabel>Please tell us more...</FieldLabel>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={isBug ? "What happened, and what were you trying to do?" : "What worked, what felt rough, or what should we improve?"}
                  className="min-h-28 resize-y"
                />
              </Field>

              <Field className="gap-2">
                <FieldLabel>Leave your email if you'd like us to follow up on this feedback.</FieldLabel>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
                <FieldDescription>
                  Please note that your details will not be used for any other purpose.
                </FieldDescription>
              </Field>

              <FeedbackAttachmentPreview
                captureState={captureState}
                screenshot={screenshot}
                includeScreenshot={includeScreenshot}
                setIncludeScreenshot={setIncludeScreenshot}
                diagnostics={diagnostics}
                includeDiagnostics={includeDiagnostics}
                setIncludeDiagnostics={setIncludeDiagnostics}
              />

              {error ? (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Feedback could not be sent</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </div>
            <DialogFooter className="border-t bg-background px-6 py-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitState === "submitting" ? <Spinner /> : null}
                Send
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FeedbackAttachmentPreview({
  captureState,
  screenshot,
  includeScreenshot,
  setIncludeScreenshot,
  diagnostics,
  includeDiagnostics,
  setIncludeDiagnostics,
}) {
  const screenshotAvailable = Boolean(screenshot?.available && screenshot?.data);
  return (
    <div className="grid gap-4">
      <div className="border-t border-border/70 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Screenshot</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {captureState === "loading"
                ? "Capturing the current Squad window..."
                : screenshotAvailable
                  ? "Captured from a Chromium replay of this route."
                  : screenshot?.error || "Screenshot unavailable."}
            </p>
          </div>
          {screenshotAvailable ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setIncludeScreenshot(!includeScreenshot)}>
              {includeScreenshot ? "Remove" : "Attach"}
            </Button>
          ) : null}
        </div>
        {captureState === "loading" ? (
          <Skeleton className="mt-3 h-36 w-full rounded-md" />
        ) : screenshotAvailable ? (
          <div className={cn("mt-3 overflow-hidden rounded-md border border-border/70", !includeScreenshot && "opacity-45")}>
            <img
              alt="Captured Squad screen"
              src={`data:${screenshot.mimeType || "image/png"};base64,${screenshot.data}`}
              className="max-h-64 w-full object-cover object-top"
            />
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground">
            Screenshot unavailable. You can still send feedback.
          </div>
        )}
      </div>

      <div className="border-t border-border/70 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Diagnostics</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Version, OS, folder names, and app logs from the last minute.
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setIncludeDiagnostics(!includeDiagnostics)}>
            {includeDiagnostics ? "Remove" : "Attach"}
          </Button>
        </div>
        <div className={cn("mt-3 grid gap-2 rounded-md bg-muted/30 p-3 text-xs", !includeDiagnostics && "opacity-45")}>
          <div className="grid gap-2 sm:grid-cols-3">
            <span className="truncate">Squad {diagnostics?.squadVersion || "unknown"}</span>
            <span className="truncate">{diagnostics?.platform || "platform pending"}</span>
            <span className="truncate">{diagnostics?.logCount ?? 0} recent logs</span>
          </div>
          {diagnostics?.folderNames?.length ? (
            <div className="truncate text-muted-foreground">{diagnostics.folderNames.slice(0, 8).join(", ")}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SettingsAnalyticsPage({ locale = DEFAULT_LOCALE, copy = getLocaleCopy(DEFAULT_LOCALE) }) {
  return (
    <div className="min-h-screen bg-background">
      <PageTitle title="Usage" />
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        <AnalyticsPanel active locale={locale} />
      </div>
    </div>
  );
}

function SettingsPage({
  themePreference,
  setThemePreference,
  handoffSettings,
  setHandoffSettings,
  chatSettings,
  setChatSettings,
  effectiveTheme,
  systemTheme,
  localePreference,
  setLocalePreference,
  localeResolution,
  copy = getLocaleCopy(DEFAULT_LOCALE),
  runtime,
  navigate,
  providerSettings,
  providerSettingsError = "",
  initialSection = "",
  counts = EMPTY_MISSION_COUNTS,
  onProviderSettingsChange,
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
  const visibleThemePreset = getThemePreset(normalizedThemePreference, visibleThemePresetSurface);
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
  const normalizedChatSettings = normalizeChatSettings(chatSettings);
  const chatSettingsDetail = normalizedChatSettings.displayCliOutput
    ? "Diagnostics visible"
    : "Clean answers";
  const providerSettingsSummary = providerSettings
    ? providerSummaryLabel(effectiveModelForAgent({ modelAssignment: { mode: "inherit" } }, providerSettings))
    : "Loading providers";
  const missionControlDetail = `${formatLocalizedNumber(counts.tasks || 0, activeLocale)} tracked ${
    counts.tasks === 1 ? "task" : "tasks"
  }`;
  const settingsSections = [
    { id: "appearance", icon: Palette, label: copy.theme, detail: `${activeThemeLabel} / ${visibleThemePreset.label}` },
    { id: "language", icon: Languages, label: copy.language, detail: formatLocaleSummary(activeLocale, activeLocale) },
    { id: "providers", icon: Brain, label: "LLM Providers", detail: providerSettingsSummary },
    { id: "chat", icon: MessageSquareText, label: copy.chat, detail: chatSettingsDetail },
    { id: "handoff", icon: Workflow, label: copy.handoffRetryPolicy, detail: handoffRetryModeLabel(effectiveHandoffRetryMode, copy) },
    { id: "mission-control", icon: Monitor, label: "Mission Control", detail: missionControlDetail },
    { id: "runtime", icon: Server, label: copy.runtimeBridge, detail: runtime?.version || copy.checkingRuntime },
  ];
  const requestedInitialSection = settingsSections.some((section) => section.id === initialSection) ? initialSection : "";

  useEffect(() => {
    if (!requestedInitialSection) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`settings-${requestedInitialSection}`)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedInitialSection]);

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

  function updateChatSetting(key, value) {
    setChatSettings((current) =>
      normalizeChatSettings({
        ...normalizeChatSettings(current),
        [key]: value,
      })
    );
  }

  function handleLocalNavigation(event, path) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
  }

  return (
    <div className="min-h-screen bg-background">
      <PageTitle title={copy.settings} />
      <div className="w-full max-w-5xl px-4 py-7 sm:px-6 lg:px-10 lg:py-8">
        <div className="min-w-0">
          <header className="border-b border-border/70 pb-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-primary">
                  <Settings className="size-4" />
                  <span>{copy.consolePreferences}</span>
                </div>
                <h2 className="text-balance text-3xl font-semibold tracking-normal sm:text-4xl">{copy.settings}</h2>
                <p className="mt-3 max-w-2xl truncate text-sm text-muted-foreground">
                  {runtime?.autohandPath || "Autohand path not found"}
                </p>
              </div>

              <div className="min-w-0 text-sm lg:w-72 lg:text-right">
                <div className="flex items-center gap-2 lg:justify-end">
                  <span className="font-medium">{copy.runtimeBridge}</span>
                  <StatusBadge status={runtime?.available ? "ready" : "offline"} copy={copy} />
                </div>
                <p className="mt-2 truncate text-xs text-muted-foreground">{runtime?.version || copy.checkingRuntime}</p>
              </div>
            </div>

            <div className="mt-8 grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-6">
              <SettingsSummaryTile icon={Palette} label={copy.theme} value={`${activeThemeLabel} / ${visibleThemePreset.label}`} detail={themeModeDetail} />
              <SettingsSummaryTile icon={Languages} label={copy.language} value={formatLocaleSummary(activeLocale, activeLocale)} detail={localeDetail} />
              <SettingsSummaryTile icon={Brain} label="LLM Providers" value={providerSettingsSummary} detail="Applies to new runs." />
              <SettingsSummaryTile icon={MessageSquareText} label={copy.chat} value={chatSettingsDetail} detail="Raw diagnostic output stays hidden unless enabled." />
              <SettingsSummaryTile icon={Workflow} label={copy.handoffRetryPolicy} value={handoffRetryModeLabel(effectiveHandoffRetryMode, copy)} detail={handoffRetryDetail} />
              <SettingsSummaryTile icon={Monitor} label="Mission Control" value={formatLocalizedNumber(counts.tasks || 0, activeLocale)} detail="Open from Settings." />
            </div>

            <div className="mt-6 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <code translate="no" className="block min-w-0 truncate rounded-md bg-muted/35 px-2.5 py-2">
                {runtime?.workspaceRoot || copy.yourUserDirectory}
              </code>
              <code translate="no" className="block min-w-0 truncate rounded-md bg-muted/35 px-2.5 py-2">
                AUTOHAND_SQUAD_HANDOFF_RETRY_MODE={handoffRetryModeLabel(bridgeHandoffRetryMode, copy)}
              </code>
            </div>

            <nav aria-label={`${copy.settings} sections`} className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {settingsSections.map((section) => {
                const Icon = section.icon;
                return (
                  <a
                    key={section.id}
                    href={`#settings-${section.id}`}
                    className="flex min-h-9 max-w-full items-center gap-2 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{section.label}</span>
                  </a>
                );
              })}
            </nav>
          </header>

          <div className="flex min-w-0 flex-col">
            <section id="settings-appearance" className="scroll-mt-8 border-b border-border/70 py-10">
              <SettingsSectionHeader icon={Palette} title={copy.theme} description={copy.themeDescription} />
              <div className="grid gap-8">
                <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{copy.theme}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{themeModeDetail}</p>
                  </div>
                  <ToggleGroup
                    type="single"
                    value={normalizedThemePreference.mode}
                    onValueChange={(value) => value && updateThemeMode(value)}
                    variant="outline"
                    className="grid w-full grid-cols-3 sm:max-w-md"
                    aria-label={copy.theme}
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
                </div>

                <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <h4 id="theme-presets-title" className="text-sm font-medium">{copy.themePresets}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">{copy.themePresetsDescription}</p>
                  </div>
                  <div aria-labelledby="theme-presets-title" className="grid gap-6 lg:grid-cols-2">
                    {THEME_SURFACES.map((surface) => (
                      <ThemePresetControl
                        key={surface}
                        surface={surface}
                        value={normalizedThemePreference[`${surface}Theme`]}
                        active={visibleThemePresetSurface === surface}
                        copy={copy}
                        onValueChange={(value) => updateThemePreset(surface, value)}
                      />
                    ))}
                    {normalizedThemePreference.mode === THEME_MODE_SYSTEM ? (
                      <p className="text-xs text-muted-foreground lg:col-span-2">
                        {formatCopy(copy.systemPreferenceSummary, {
                          theme: systemTheme === THEME_MODE_LIGHT ? copy.light : copy.dark,
                        })}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section id="settings-language" className="scroll-mt-8 border-b border-border/70 py-10">
              <SettingsSectionHeader icon={Languages} title={copy.language} description={localeDetail} />
              <div className="grid gap-8">
                <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
                  <SettingsSummaryTile icon={Globe2} label={copy.osLanguage} value={formatLocaleSummary(systemLocale, activeLocale)} detail={copy.useAutomaticLocale} />
                  <SettingsSummaryTile icon={Languages} label={copy.manualLanguage} value={formatLocaleSummary(manualLocale, activeLocale)} detail={selectedLocaleValue === LOCALE_MODE_AUTO ? copy.automatic : copy.manualLanguage} />
                </div>

                <Field className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
                  <FieldLabel className="text-sm font-medium">{copy.language}</FieldLabel>
                  <Select value={selectedLocaleValue} onValueChange={updateLocale}>
                    <SelectTrigger className="h-10 w-full min-w-0 justify-between sm:max-w-md" aria-label={copy.language}>
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
              </div>
            </section>

            <section id="settings-providers" className="scroll-mt-8 border-b border-border/70 py-10">
              <SettingsSectionHeader icon={Brain} title="LLM Providers" description="Configure the provider registry and workspace default used by new agent runs." />
              <ProviderSettingsPanel
                providerSettings={providerSettings}
                providerSettingsError={providerSettingsError}
                onProviderSettingsChange={onProviderSettingsChange}
              />
            </section>

            <section id="settings-chat" className="scroll-mt-8 border-b border-border/70 py-10">
              <SettingsSectionHeader icon={MessageSquareText} title={copy.chat} description="Keep normal replies focused, with runtime diagnostics available when you need them." />
              <FieldGroup>
                <Field orientation="horizontal" className="items-center justify-between gap-4 rounded-md border bg-background px-3 py-3">
                  <FieldContent className="gap-1">
                    <FieldTitle>Display diagnostic output</FieldTitle>
                    <FieldDescription>Show raw stdout and stderr for troubleshooting. Leave this off for clean answers.</FieldDescription>
                  </FieldContent>
                  <Switch
                    checked={normalizedChatSettings.displayCliOutput}
                    onCheckedChange={(checked) => updateChatSetting("displayCliOutput", checked)}
                    aria-label="Display diagnostic output"
                  />
                </Field>
              </FieldGroup>
            </section>

            <section id="settings-handoff" className="scroll-mt-8 border-b border-border/70 py-10">
              <SettingsSectionHeader icon={Workflow} title={copy.handoffRetryPolicy} description={handoffRetryDetail} />
              <div className="divide-y divide-border/65">
                {[HANDOFF_RETRY_BRIDGE_DEFAULT, ...HANDOFF_RETRY_MODES].map((mode) => (
                  <HandoffRetryChoice
                    key={mode}
                    mode={mode}
                    selected={selectedHandoffRetryValue === mode}
                    bridgeDefaultMode={bridgeHandoffRetryMode}
                    copy={copy}
                    onSelect={updateHandoffRetryMode}
                  />
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {formatCopy(copy.handoffRetryEnvDefault, {
                  variable: "AUTOHAND_SQUAD_HANDOFF_RETRY_MODE",
                  mode: handoffRetryModeLabel(bridgeHandoffRetryMode, copy),
                })}
              </p>
            </section>

            <section id="settings-mission-control" className="scroll-mt-8 border-b border-border/70 py-10">
              <SettingsSectionHeader icon={Monitor} title="Mission Control" description={missionControlDetail} />
              <a
                href={missionControlPath()}
                className="grid gap-3 rounded-md px-2 py-4 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                onClick={(event) => handleLocalNavigation(event, missionControlPath())}
              >
                <span className="min-w-0">
                  <span className="block font-medium">Open Mission Control</span>
                  <span className="mt-1 block truncate text-sm text-muted-foreground">Review active work, queue, and run evidence.</span>
                </span>
                <Badge variant={counts.permissionWarnings ? "destructive" : "secondary"} className="w-fit rounded-md px-1.5">
                  {formatLocalizedNumber(counts.tasks || 0, activeLocale)}
                </Badge>
              </a>
            </section>

            <section id="settings-runtime" className="scroll-mt-8 py-10">
              <SettingsSectionHeader icon={Server} title={copy.runtimeBridge} description={runtime?.version || copy.checkingRuntime} />
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="divide-y divide-border/65">
                  <a
                    href="/extensions"
                    className="grid gap-3 rounded-md px-2 py-4 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    onClick={(event) => handleLocalNavigation(event, "/extensions")}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{copy.runtimeBridge}</span>
                      <span className="mt-1 block truncate text-sm text-muted-foreground">{runtime?.autohandPath || "Autohand path not found"}</span>
                    </span>
                    <ChevronRight className="hidden size-4 text-muted-foreground sm:block" />
                  </a>
                  <a
                    href="/usage"
                    className="grid gap-3 rounded-md px-2 py-4 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    onClick={(event) => handleLocalNavigation(event, "/usage")}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{copy.analytics}</span>
                      <span className="mt-1 block truncate text-sm text-muted-foreground">{runtime?.version || copy.checkingRuntime}</span>
                    </span>
                    <ArrowUpRight className="hidden size-4 text-muted-foreground sm:block" />
                  </a>
                </div>

                <div className="min-w-0">
                  <div className="text-sm font-medium">{copy.localStorage}</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.localStorageDescription}</p>
                  <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
                    <code translate="no" className="block min-w-0 truncate rounded-md bg-muted/35 px-2.5 py-2">{STORAGE_KEYS.theme}</code>
                    <code translate="no" className="block min-w-0 truncate rounded-md bg-muted/35 px-2.5 py-2">{STORAGE_KEYS.locale}</code>
                    <code translate="no" className="block min-w-0 truncate rounded-md bg-muted/35 px-2.5 py-2">{STORAGE_KEYS.chatSettings}</code>
                    <code translate="no" className="block min-w-0 truncate rounded-md bg-muted/35 px-2.5 py-2">{STORAGE_KEYS.handoffSettings}</code>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderSettingsPanel({ providerSettings, providerSettingsError = "", onProviderSettingsChange }) {
  const [draft, setDraft] = useState(providerSettings);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [testStatus, setTestStatus] = useState({});
  const [expandedProvider, setExpandedProvider] = useState("");
  const definitions = providerDefinitionsFromSettings(draft || providerSettings);
  const hasChanges = Boolean(draft && providerSettings && JSON.stringify(draft) !== JSON.stringify(providerSettings));
  const bridgeUnavailable = Boolean(providerSettingsError && draft);

  useEffect(() => {
    setDraft(providerSettings);
    setExpandedProvider(String(providerSettings?.defaultProvider || "openrouter"));
    setStatus("");
    setTestStatus({});
  }, [providerSettings]);

  function updateProvider(providerId, patch) {
    setDraft((current) => ({
      ...current,
      providers: {
        ...(current?.providers || {}),
        [providerId]: {
          ...(current?.providers?.[providerId] || {}),
          ...patch,
        },
      },
    }));
    setStatus("");
  }

  function updateDefaultProvider(defaultProvider) {
    setDraft((current) => ({
      ...current,
      defaultProvider,
      providers: {
        ...(current?.providers || {}),
        [defaultProvider]: {
          ...(current?.providers?.[defaultProvider] || {}),
          enabled: true,
        },
      },
    }));
    setExpandedProvider(defaultProvider);
    setStatus("");
  }

  async function save() {
    if (!draft || bridgeUnavailable) return;
    setSaving(true);
    setStatus("");
    try {
      const saved = await api("/api/provider-settings", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      onProviderSettingsChange?.(saved);
      setDraft(saved);
      setStatus("Provider settings saved. New runs will use the updated registry.");
    } catch (error) {
      setStatus(error.message || "Provider settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function testProvider(providerId) {
    if (bridgeUnavailable) return;
    setTestStatus((current) => ({ ...current, [providerId]: { state: "testing", message: "Checking..." } }));
    try {
      const result = await api("/api/provider-settings/test", {
        method: "POST",
        body: JSON.stringify({ provider: providerId, providerSettings: draft }),
      });
      setTestStatus((current) => ({ ...current, [providerId]: { state: "ok", message: result.message || "Configured" } }));
    } catch (error) {
      setTestStatus((current) => ({ ...current, [providerId]: { state: "error", message: error.message || "Missing required fields" } }));
    }
  }

  if (providerSettingsError && !draft) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Provider settings unavailable</AlertTitle>
        <AlertDescription>{providerSettingsError}</AlertDescription>
      </Alert>
    );
  }

  if (!draft) {
    return <Skeleton className="h-44 w-full rounded-md" />;
  }

  return (
    <div className="grid gap-6">
      {providerSettingsError ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Provider settings need a restart</AlertTitle>
          <AlertDescription>{providerSettingsError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <div className="text-sm font-medium">Workspace default</div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">Agents inherit this provider unless their profile overrides it.</p>
        </div>
        <Select value={draft.defaultProvider} onValueChange={updateDefaultProvider}>
          <SelectTrigger className="h-10 w-full min-w-0 justify-between sm:max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Default provider</SelectLabel>
              {definitions.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="divide-y divide-border/70">
        {definitions.map((definition) => {
          const provider = draft.providers?.[definition.id] || {};
          const providerStatus = testStatus[definition.id];
          const configured = providerIsConfigured(draft, definition.id);
          const isExpanded = expandedProvider === definition.id;
          return (
            <section key={definition.id} className={cn("py-4", isExpanded ? "border-b border-border/70 pb-5" : "")}>
              <button
                type="button"
                className="flex w-full items-start gap-2 text-left"
                onClick={() => setExpandedProvider(isExpanded ? "" : definition.id)}
              >
                <ChevronRight className={cn("mt-0.5 size-4 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                <div className="grid min-w-0 flex-1 gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{definition.label}</span>
                      <Badge variant="outline" className="rounded-md text-[10px]">
                        {configured ? "Configured" : "Incomplete"}
                      </Badge>
                      {definition.id === draft.defaultProvider ? <Badge variant="secondary" className="rounded-md text-[10px]">Default</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {definition.kind === "local" ? "Local runtime provider." : "Provider connection used for new runs."}
                    </p>
                  </div>
                </div>
              </button>

              {isExpanded ? (
                <div className="mt-4 grid gap-4">
                  <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="min-w-0" />
                    <Field orientation="horizontal" className="items-center justify-between gap-4">
                      <FieldContent className="gap-1">
                        <FieldTitle>Enabled</FieldTitle>
                        <FieldDescription>{draft.defaultProvider === definition.id ? "Enabled because it is the workspace default." : "Available for agent overrides."}</FieldDescription>
                      </FieldContent>
                      <Switch
                        checked={provider.enabled === true}
                        disabled={draft.defaultProvider === definition.id}
                        onCheckedChange={(enabled) => updateProvider(definition.id, { enabled })}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="min-w-0" />
                    <div className="grid gap-3 md:grid-cols-2">
                      {definition.requiresApiKey ? (
                        <Field className="gap-2">
                          <FieldLabel>API key</FieldLabel>
                          <Input
                            type="password"
                            value={provider.apiKey || ""}
                            onChange={(event) => updateProvider(definition.id, { apiKey: event.target.value })}
                            placeholder={provider.apiKeyConfigured ? "Configured; enter a new key to replace" : "Enter API key"}
                            className="h-10"
                          />
                        </Field>
                      ) : null}

                      <Field className="gap-2">
                        <FieldLabel>Default model</FieldLabel>
                        <Input
                          value={provider.model || ""}
                          onChange={(event) => updateProvider(definition.id, { model: event.target.value })}
                          placeholder={definition.model || "Model ID"}
                          className="h-10"
                        />
                      </Field>

                      <Field className="gap-2">
                        <FieldLabel>Base URL</FieldLabel>
                        <Input
                          value={provider.baseUrl || ""}
                          onChange={(event) => updateProvider(definition.id, { baseUrl: event.target.value })}
                          placeholder={definition.baseUrl || "Optional"}
                          className="h-10"
                        />
                      </Field>

                      {definition.id === "bedrock" ? (
                        <>
                          <Field className="gap-2">
                            <FieldLabel>Region</FieldLabel>
                            <Input
                              value={provider.region || ""}
                              onChange={(event) => updateProvider(definition.id, { region: event.target.value })}
                              placeholder="us-east-1"
                              className="h-10"
                            />
                          </Field>
                          <Field className="gap-2">
                            <FieldLabel>AWS profile</FieldLabel>
                            <Input
                              value={provider.profile || ""}
                              onChange={(event) => updateProvider(definition.id, { profile: event.target.value })}
                              placeholder="default"
                              className="h-10"
                            />
                          </Field>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="min-w-0" />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className={cn("text-xs text-muted-foreground", providerStatus?.state === "error" && "text-destructive")}>
                        {providerStatus?.message ||
                          (bridgeUnavailable
                            ? "Restart Autohand Squad to test this provider."
                            : definition.requiresApiKey && provider.apiKeyConfigured
                              ? "Secret is stored server-side and masked here."
                              : "Changes apply to new runs after Save.")}
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => testProvider(definition.id)} disabled={bridgeUnavailable || providerStatus?.state === "testing"}>
                        {providerStatus?.state === "testing" ? <Spinner /> : <CheckCircle2 data-icon="inline-start" />}
                        Test connection
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t bg-background/95 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">{status || (bridgeUnavailable ? "Restart the local bridge before saving provider changes." : "Save provider changes explicitly before launching new runs.")}</div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={!hasChanges || saving || bridgeUnavailable} onClick={() => setDraft(providerSettings)}>
            Discard
          </Button>
          <Button type="button" disabled={!hasChanges || saving || bridgeUnavailable} onClick={save}>
            {saving ? <Spinner /> : <KeyRound data-icon="inline-start" />}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}

function SettingsSectionHeader({ icon: Icon, title, description }) {
  return (
    <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-balance text-xl font-semibold">{title}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

function SettingsSummaryTile({ icon: Icon, label, value, detail }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-4" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 truncate text-sm font-semibold">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function HandoffRetryChoice({ mode, selected, bridgeDefaultMode, copy = getLocaleCopy(DEFAULT_LOCALE), onSelect }) {
  const isBridgeDefault = mode === HANDOFF_RETRY_BRIDGE_DEFAULT;
  const label = isBridgeDefault
    ? formatCopy(copy.useBridgeDefault, { mode: handoffRetryModeLabel(bridgeDefaultMode, copy) })
    : handoffRetryModeLabel(mode, copy);
  const description = isBridgeDefault
    ? formatCopy(copy.handoffRetryBridgeDefaultDetail, { mode: handoffRetryModeLabel(bridgeDefaultMode, copy) })
    : handoffRetryModeDescription(mode, copy);
  const Icon =
    mode === "checkpoint"
      ? ClipboardCheck
      : mode === "manual"
        ? PauseCircle
        : mode === "disabled"
          ? Ban
          : Server;

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "flex min-h-24 w-full items-start gap-4 rounded-md px-2 py-4 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-primary/10"
      )}
      onClick={() => onSelect(mode)}
    >
      <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground", selected && "text-primary")}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-2 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </button>
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
    const timer = window.setInterval(load, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);

  const work = snapshot?.work || {};
  const services = snapshot?.services || {};
  const telemetry = snapshot?.telemetry || {};
  const usage = snapshot?.usage || {};
  const versions = snapshot?.versions || {};
  const timestamps = snapshot?.timestamps || {};
  const recentErrors = Array.isArray(snapshot?.recentErrors) ? snapshot.recentErrors : [];
  const eventEntries = Object.entries(telemetry.eventCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const serviceRows = [
    { label: "Squad daemon", detail: "Runs local squad member work", record: services.mainDaemon },
    { label: "Analytics daemon", detail: "Streams service metrics", record: services.analyticsDaemon },
    { label: "Web server", detail: "Serves this console", record: services.webServer },
  ];
  const runningServices = serviceRows.filter((row) => row.record?.running || row.record?.url).length;
  const serviceHealth = serviceRows.length ? Math.round((runningServices / serviceRows.length) * 100) : 0;
  const analyticsDaemonOnline = Boolean(services.analyticsDaemon?.running || services.analyticsDaemon?.url);
  const activeDaemons = Number(services.activeDaemons ?? 0);
  const activeWork = Number(work.activeWork ?? 0);
  const queueVolume = Number(work.queueVolume ?? 0);
  const failureRatePercent = Math.round((Number(work.failureRate) || 0) * 100);
  const telemetryEvents = Number(telemetry.totalEvents ?? 0);
  const telemetryErrorCount = Number(telemetry.errors ?? 0);
  const usageRecords = Number(usage.totalRecords ?? 0);
  const usageTokens = Number(usage.totalTokens ?? 0);
  const latestSignal =
    formatAnalyticsTimestamp(usage.lastUsageAt || telemetry.lastEventAt || timestamps.lastTelemetryFlushAt || timestamps.lastSnapshotAt || snapshot?.generatedAt, locale) ||
    "No signal yet";
  const generatedAt = formatAnalyticsTimestamp(snapshot?.generatedAt, locale) || "Waiting for local data";
  const runtimeVersion = versions.installedVersion || versions.runtimeVersion || "web prototype";
  const attentionCount = (analyticsDaemonOnline ? 0 : 1) + recentErrors.length + (failureRatePercent > 0 ? 1 : 0);
  const heroTone = error || attentionCount > 0 ? "attention" : activeDaemons > 0 || runningServices > 0 ? "live" : "quiet";
  const operatorBrief = buildAnalyticsOperatorBrief({
    error,
    analyticsDaemonOnline,
    serviceHealth,
    recentErrors,
    failureRatePercent,
    queueDepth: Number(work.queueDepth ?? 0),
    activeWork,
  });
  const metricCards = [
    {
      label: "Active daemons",
      value: activeDaemons,
      detail: snapshot?.source || "local fallback",
      meta: `${runningServices}/${serviceRows.length} services`,
      meter: serviceHealth,
      icon: Server,
      tone: "primary",
    },
    {
      label: "Active work",
      value: activeWork,
      detail: `${formatAnalyticsNumber(work.workingAgents ?? 0, locale)} working agents`,
      meta: `${formatAnalyticsNumber(work.onlineMembers ?? 0, locale)} online`,
      meter: Math.min(activeWork * 20, 100),
      icon: Activity,
      tone: "primary",
    },
    {
      label: "Queue volume",
      value: queueVolume,
      detail: `${formatAnalyticsNumber(work.scheduledJobs ?? 0, locale)} scheduled`,
      meta: `${formatAnalyticsNumber(work.queueDepth ?? 0, locale)} queued`,
      meter: Math.min(queueVolume * 12, 100),
      icon: LayoutList,
      tone: "chart",
    },
    {
      label: "Failure rate",
      value: formatAnalyticsPercent(work.failureRate),
      detail: recentErrors.length
        ? `${formatAnalyticsNumber(recentErrors.length, locale)} recent failures`
        : `${formatAnalyticsNumber(work.failedRuns ?? 0, locale)} failed runs`,
      meta: `${formatAnalyticsNumber(work.completedRuns ?? 0, locale)} completed`,
      meter: failureRatePercent,
      icon: AlertTriangle,
      tone: failureRatePercent > 0 || recentErrors.length ? "destructive" : "muted",
    },
    {
      label: "Usage records",
      value: usageRecords,
      detail: `${formatAnalyticsNumber(usageTokens, locale)} tokens observed`,
      meta: latestSignal,
      meter: Math.min(usageRecords * 12, 100),
      icon: Gauge,
      tone: "chart",
    },
  ];
  const queueRows = [
    { label: "Running", value: Number(work.runningRuns ?? 0), tone: "primary" },
    { label: "Completed", value: Number(work.completedRuns ?? 0), tone: "primary" },
    { label: "Failed", value: Number(work.failedRuns ?? 0), tone: "destructive" },
    { label: "Rejected", value: Number(work.rejectedRuns ?? 0), tone: "muted" },
  ];
  const telemetryChartRows = eventEntries.map(([event, count], index) => {
    const colorKey = analyticsChartColorKey(index);
    return {
      event,
      label: analyticsEventLabel(event),
      value: Number(count) || 0,
      fill: `var(--color-${colorKey})`,
    };
  });
  const signalRows = analyticsSignalRows(timestamps, locale);
  const usageTopHarnesses = Array.isArray(usage.topHarnesses) ? usage.topHarnesses : [];
  const usageTopProviders = Array.isArray(usage.topProviders) ? usage.topProviders : [];
  const usageTopModels = Array.isArray(usage.topModels) ? usage.topModels : [];
  const recentUsage = Array.isArray(usage.recent) ? usage.recent : [];
  const surfaceRows = Object.entries(telemetry.surfaceCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([surface, count], index) => ({
      label: analyticsEventLabel(surface),
      value: Number(count) || 0,
      tone: index === 0 ? "primary" : index === 1 ? "chart" : "muted",
    }));

  if (loading && !snapshot) {
    return <AnalyticsLoadingState />;
  }

  return (
    <section className="flex flex-col gap-5" aria-label="Analytics">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Analytics unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {recentErrors.length && !error ? (
        <Alert className="border-destructive/45 bg-destructive/10">
          <ShieldAlert />
          <AlertTitle>Recent upstream failures detected</AlertTitle>
          <AlertDescription>
            {formatAnalyticsNumber(recentErrors.length, locale)} recent failure signals are present even though the aggregate error counter is {formatAnalyticsNumber(telemetryErrorCount, locale)}.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden rounded-lg border-border/80 bg-card/85 shadow-sm">
        <CardHeader className="border-b pb-5 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={heroTone === "attention" ? "destructive" : "secondary"} className="rounded-md">
                <CircleDot data-icon="inline-start" />
                {heroTone === "attention" ? "Needs attention" : heroTone === "live" ? "Live telemetry" : "Local snapshot"}
              </Badge>
              {versions.updateAvailable === true ? (
                <Badge variant="outline" className="rounded-md">
                  <ArrowUpRight data-icon="inline-start" />
                  Update available
                </Badge>
              ) : null}
            </div>
            <CardTitle className="mt-4 text-3xl tracking-normal sm:text-4xl">Squad operations, at a glance</CardTitle>
            <CardDescription className="mt-3 max-w-2xl text-base leading-7">
              Runtime health, queue pressure, signal freshness, and the next action for the local Autohand Squad bridge.
            </CardDescription>
          </div>
          <CardAction>
            <Button type="button" variant="outline" onClick={loadAnalytics} disabled={loading}>
              <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
              Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-0 p-0 sm:grid-cols-3">
          <AnalyticsHeroStat
            label="Service health"
            value={`${serviceHealth}%`}
            detail={`${runningServices} of ${serviceRows.length} services reporting`}
          />
          <AnalyticsHeroStat label="Latest snapshot" value={generatedAt} detail={runtimeVersion} />
          <AnalyticsHeroStat label="Last signal" value={latestSignal} detail={`${formatAnalyticsNumber(telemetryEvents, locale)} events observed`} />
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {metricCards.map((metric) => (
          <AnalyticsMetricCard key={metric.label} metric={metric} locale={locale} />
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <AnalyticsUsageBreakdown
          title="Top usage harnesses"
          description="Code CLI and runtime harness activity from telemetry and run records."
          rows={usageTopHarnesses}
          locale={locale}
        />
        <AnalyticsUsageBreakdown
          title="Top models and providers"
          description="Provider and model usage collected by the local analytics subprocess."
          rows={[...usageTopProviders, ...usageTopModels].slice(0, 10)}
          locale={locale}
          secondaryLabel="Model/provider"
        />
      </div>

      <AnalyticsRecentUsage rows={recentUsage} locale={locale} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <AnalyticsOperatorBrief
          brief={operatorBrief}
          serviceHealth={serviceHealth}
          attentionCount={attentionCount}
          runningServices={runningServices}
          serviceCount={serviceRows.length}
          locale={locale}
        />
        <AnalyticsTelemetryChart
          rows={telemetryChartRows}
          totalEvents={telemetryEvents}
          surfaceRows={surfaceRows}
          locale={locale}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <AnalyticsServiceTable rows={serviceRows} runtimeVersion={runtimeVersion} runningServices={runningServices} />
        <AnalyticsSignalFreshness rows={signalRows} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="rounded-lg border-border/80 bg-card/75 shadow-none">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">Work outcomes</CardTitle>
            <CardDescription>{formatAnalyticsNumber(work.totalRuns ?? 0, locale)} total runs observed</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {queueRows.map((row) => (
              <AnalyticsBarRow
                key={row.label}
                label={row.label}
                value={row.value}
                max={Math.max(...queueRows.map((item) => item.value), 1)}
                locale={locale}
                tone={row.tone}
              />
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-lg border-border/80 bg-card/75 shadow-none">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">Queue throughput</CardTitle>
            <CardDescription>{formatAnalyticsNumber(telemetry.queueCreated ?? 0, locale)} queue creates tracked</CardDescription>
            <CardAction>
              <Badge variant={telemetryErrorCount ? "destructive" : "secondary"} className="rounded-md">
                {formatAnalyticsNumber(telemetryErrorCount, locale)} errors
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {[
              { label: "Created", value: Number(telemetry.queueCreated ?? 0), tone: "primary" },
              { label: "Started", value: Number(telemetry.queueStarted ?? 0), tone: "chart" },
              { label: "Completed", value: Number(telemetry.queueCompleted ?? 0), tone: "primary" },
              { label: "Failed", value: Number(telemetry.queueFailed ?? 0), tone: "destructive" },
            ].map((row) => (
              <AnalyticsBarRow
                key={row.label}
                label={row.label}
                value={row.value}
                max={Math.max(
                  Number(telemetry.queueCreated ?? 0),
                  Number(telemetry.queueStarted ?? 0),
                  Number(telemetry.queueCompleted ?? 0),
                  Number(telemetry.queueFailed ?? 0),
                  1
                )}
                locale={locale}
                tone={row.tone}
              />
            ))}
          </CardContent>
        </Card>
      </div>

      <AnalyticsFailureList recentErrors={recentErrors} locale={locale} />
    </section>
  );
}

function AnalyticsLoadingState() {
  return (
    <section className="flex flex-col gap-5" aria-label="Analytics loading">
      <Card className="overflow-hidden rounded-lg">
        <CardHeader className="border-b pb-5">
          <Skeleton className="h-5 w-32 rounded-md" />
          <Skeleton className="h-10 w-full max-w-lg rounded-md" />
          <Skeleton className="h-5 w-full max-w-2xl rounded-md" />
        </CardHeader>
        <CardContent className="grid gap-0 p-0 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="border-border/70 p-5 sm:border-r sm:last:border-r-0">
              <Skeleton className="h-4 w-24 rounded-md" />
              <Skeleton className="mt-4 h-8 w-32 rounded-md" />
              <Skeleton className="mt-3 h-4 w-40 rounded-md" />
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-44 rounded-lg" />
        ))}
      </div>
    </section>
  );
}

const ANALYTICS_CHART_COLOR_KEYS = ["eventA", "eventB", "eventC", "eventD", "eventE", "eventF"];

const ANALYTICS_EVENT_CHART_CONFIG = {
  value: {
    label: "Events",
  },
  eventA: {
    label: "Primary",
    color: "var(--chart-1)",
  },
  eventB: {
    label: "Secondary",
    color: "var(--chart-4)",
  },
  eventC: {
    label: "Tertiary",
    color: "var(--chart-3)",
  },
  eventD: {
    label: "Quaternary",
    color: "var(--chart-2)",
  },
  eventE: {
    label: "Fifth",
    color: "var(--chart-5)",
  },
  eventF: {
    label: "Sixth",
    color: "var(--muted-foreground)",
  },
};

function AnalyticsOperatorBrief({ brief, serviceHealth, attentionCount, runningServices, serviceCount, locale }) {
  const Icon = brief.icon;
  const tone = analyticsToneClasses(brief.tone);
  const badgeVariant = brief.tone === "destructive" || brief.tone === "attention" ? "destructive" : "secondary";

  return (
    <Card className="rounded-lg border-border/80 bg-card/75 shadow-none">
      <CardHeader className="border-b pb-4">
        <div className="flex items-start gap-3">
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-md", tone.icon)}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-base">{brief.title}</CardTitle>
            <CardDescription className="mt-1 leading-6">{brief.detail}</CardDescription>
          </div>
        </div>
        <CardAction>
          <Badge variant={badgeVariant} className="rounded-md">
            {attentionCount ? `${formatAnalyticsNumber(attentionCount, locale)} signals` : "Healthy"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Service readiness</span>
            <span className="font-medium">{runningServices}/{serviceCount} online</span>
          </div>
          <Progress
            value={serviceHealth}
            aria-label="Service readiness"
            className={cn("h-2", tone.progress)}
          />
        </div>
        <div className="rounded-md border bg-muted/25 p-4">
          <div className="text-xs font-medium uppercase text-muted-foreground">Operator action</div>
          <p className="mt-2 text-sm leading-6">{brief.action}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalyticsTelemetryChart({ rows, totalEvents, surfaceRows, locale }) {
  const maxSurfaceValue = Math.max(...surfaceRows.map((row) => row.value), 1);

  return (
    <Card className="rounded-lg border-border/80 bg-card/75 shadow-none">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-base">Telemetry mix</CardTitle>
        <CardDescription>Top events and reporting surfaces from the local bridge.</CardDescription>
        <CardAction>
          <Badge variant="outline" className="rounded-md">
            {formatAnalyticsNumber(totalEvents, locale)} events
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(14rem,0.7fr)]">
        {rows.length ? (
          <ChartContainer config={ANALYTICS_EVENT_CHART_CONFIG} className="h-[260px] w-full">
            <BarChart
              accessibilityLayer
              data={rows}
              layout="vertical"
              margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
            >
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <YAxis
                dataKey="label"
                type="category"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={118}
                tickFormatter={(value) => truncateAnalyticsLabel(value, 18)}
              />
              <XAxis type="number" hide />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel indicator="line" />} />
              <Bar dataKey="value" radius={4}>
                {rows.map((row) => (
                  <Cell key={row.event} fill={row.fill} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        ) : (
          <Empty className="border-0 bg-muted/25 py-8">
            <EmptyMedia variant="icon"><Gauge /></EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No telemetry yet</EmptyTitle>
              <EmptyDescription>Events will appear here once the local bridge starts reporting.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <div className="flex flex-col gap-3">
          <div className="text-xs font-medium uppercase text-muted-foreground">Reporting surfaces</div>
          {surfaceRows.length ? (
            surfaceRows.map((row) => (
              <AnalyticsBarRow
                key={row.label}
                label={row.label}
                value={row.value}
                max={maxSurfaceValue}
                locale={locale}
                tone={row.tone}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No surface data has been recorded yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AnalyticsServiceTable({ rows, runtimeVersion, runningServices }) {
  return (
    <Card className="rounded-lg border-border/80 bg-card/75 shadow-none">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-base">Service health</CardTitle>
        <CardDescription>{runtimeVersion}</CardDescription>
        <CardAction>
          <Badge variant="outline" className="rounded-md">
            {runningServices}/{rows.length} online
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Endpoint</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell>
                  <div className="font-medium">{row.label}</div>
                  <div className="text-xs text-muted-foreground">{row.detail}</div>
                </TableCell>
                <TableCell><StatusBadge status={row.record?.running || row.record?.url ? "ready" : "offline"} /></TableCell>
                <TableCell className="max-w-[14rem] truncate text-muted-foreground">{analyticsServiceEndpoint(row.record)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AnalyticsSignalFreshness({ rows }) {
  return (
    <Card className="rounded-lg border-border/80 bg-card/75 shadow-none">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-base">Signal freshness</CardTitle>
        <CardDescription>Last observed runtime timestamps.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => {
          const Icon = row.icon;
          const badgeVariant = row.freshness.tone === "destructive" ? "destructive" : row.freshness.tone === "primary" ? "default" : "outline";
          return (
            <div key={row.label} className="flex items-start gap-3 rounded-md border bg-muted/20 p-3">
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", analyticsToneClasses(row.freshness.tone).icon)}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium">{row.label}</div>
                  <Badge variant={badgeVariant} className="rounded-md">{row.freshness.label}</Badge>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{row.display || "not recorded"}</div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function AnalyticsFailureList({ recentErrors, locale }) {
  return (
    <Card className="rounded-lg border-border/80 bg-card/75 shadow-none">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-base">Recent failures</CardTitle>
        <CardDescription>{formatAnalyticsNumber(recentErrors.length, locale)} visible</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {recentErrors.length ? (
          recentErrors.map((item, index) => (
            <div key={`${item.runId || item.message}-${index}`} className="grid gap-3 rounded-md border bg-muted/25 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
              <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-md bg-destructive/12 text-destructive">
                <AlertTriangle className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive" className="rounded-md">{analyticsFailureKind(item.message)}</Badge>
                  <span className="text-xs text-muted-foreground">{item.source}{item.runId ? ` - ${item.runId}` : ""}</span>
                </div>
                <div className="mt-2 break-words text-sm font-medium leading-6">{item.message}</div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{formatAnalyticsTimestamp(item.at, locale) || "unknown"}</span>
            </div>
          ))
        ) : (
          <Empty className="border-0 bg-muted/25 py-8">
            <EmptyMedia variant="icon"><CheckCircle2 /></EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No recent failures</EmptyTitle>
              <EmptyDescription>Failed runs and error telemetry will show up here with timestamps.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function AnalyticsHeroStat({ label, value, detail }) {
  return (
    <div className="min-w-0 border-border/70 p-5 sm:border-r sm:last:border-r-0">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-3 truncate text-2xl font-semibold tracking-normal">{value}</div>
      <div className="mt-2 truncate text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}

function AnalyticsMetricCard({ metric, locale }) {
  const Icon = metric.icon;
  const tone = analyticsToneClasses(metric.tone);
  const value = typeof metric.value === "number" ? formatAnalyticsNumber(metric.value, locale) : metric.value;

  return (
    <Card className="overflow-hidden rounded-lg border-border/80 bg-card/75 shadow-none transition-colors hover:border-primary/45">
      <CardHeader className="gap-4 pb-0">
        <div className="flex items-start justify-between gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-md", tone.icon)}>
            <Icon className="size-4" />
          </span>
          <Badge variant="outline" className="max-w-[8rem] rounded-md">
            <span className="truncate">{metric.meta}</span>
          </Badge>
        </div>
        <div className="min-w-0">
          <CardDescription>{metric.label}</CardDescription>
          <CardTitle className="mt-2 truncate text-3xl tracking-normal">{value}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        <div className="truncate text-sm text-muted-foreground">{metric.detail}</div>
      </CardContent>
      <CardFooter className="pt-0">
        <Progress
          value={clampPercent(metric.meter)}
          aria-label={`${metric.label} meter`}
          className={cn("h-1.5", tone.progress)}
        />
      </CardFooter>
    </Card>
  );
}

function AnalyticsBarRow({ label, value, max, locale, tone = "primary" }) {
  const numericValue = Number(value) || 0;
  const width = max && numericValue > 0 ? Math.max(4, Math.round((numericValue / max) * 100)) : 0;
  const toneClass = analyticsToneClasses(tone).progress;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-muted-foreground">{label}</span>
        <span className="font-medium">{formatAnalyticsNumber(value, locale)}</span>
      </div>
      <Progress value={clampPercent(width)} aria-label={`${label} count`} className={cn("h-2", toneClass)} />
    </div>
  );
}

function AnalyticsUsageBreakdown({ title, description, rows, locale, secondaryLabel = "Harness" }) {
  const maxValue = Math.max(...rows.map((row) => Number(row.count) || 0), 1);

  return (
    <Card className="rounded-lg border-border/80 bg-card/75 shadow-none">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant="outline" className="rounded-md">
            {formatAnalyticsNumber(rows.length, locale)} tracked
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length ? (
          rows.map((row) => (
            <div key={`${title}-${row.label}`} className="grid gap-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{row.label || secondaryLabel}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatAnalyticsNumber(row.count, locale)} runs
                </span>
              </div>
              <Progress value={clampPercent(((Number(row.count) || 0) / maxValue) * 100)} aria-label={`${row.label} usage`} className="h-2" />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{formatAnalyticsNumber(row.tokens ?? 0, locale)} tokens</span>
                <span>{formatDuration(row.durationMs ?? row.duration_ms ?? 0) || "not timed"}</span>
                <span>{formatAnalyticsTimestamp(row.lastAt ?? row.last_at, locale) || "not recorded"}</span>
              </div>
            </div>
          ))
        ) : (
          <Empty className="border-0 bg-muted/25 py-8">
            <EmptyMedia variant="icon"><Gauge /></EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No usage yet</EmptyTitle>
              <EmptyDescription>Code CLI and model activity will appear after the next local run or chat.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function AnalyticsRecentUsage({ rows, locale }) {
  return (
    <Card className="rounded-lg border-border/80 bg-card/75 shadow-none">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-base">Recent usage</CardTitle>
        <CardDescription>Live records collected from telemetry, chat streams, and run files.</CardDescription>
        <CardAction>
          <Badge variant="secondary" className="rounded-md">
            {formatAnalyticsNumber(rows.length, locale)} latest
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Harness</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={`${row.at || "usage"}-${row.harness || index}-${index}`}>
                  <TableCell>
                    <div className="font-medium">{row.harness || "runtime"}</div>
                    <div className="text-xs text-muted-foreground">{row.source || "telemetry"}</div>
                  </TableCell>
                  <TableCell className="max-w-[14rem] truncate text-muted-foreground">
                    {[row.provider, row.model].filter(Boolean).join(" / ") || "not recorded"}
                  </TableCell>
                  <TableCell><StatusBadge status={row.status === "failed" ? "failed" : row.status === "running" ? "running" : "ready"} /></TableCell>
                  <TableCell>{formatAnalyticsNumber(row.tokens ?? 0, locale)}</TableCell>
                  <TableCell>{formatDuration(row.durationMs ?? row.duration_ms ?? 0) || "not timed"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatAnalyticsTimestamp(row.at, locale) || "not recorded"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty className="border-0 bg-muted/25 py-8">
            <EmptyMedia variant="icon"><Clock3 /></EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No recent usage</EmptyTitle>
              <EmptyDescription>Run a Squad member or chat request to populate this live usage feed.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function analyticsToneClasses(tone) {
  if (tone === "destructive") {
    return {
      icon: "bg-destructive/12 text-destructive",
      progress: "bg-destructive/15 [&_[data-slot=progress-indicator]]:bg-destructive",
    };
  }
  if (tone === "attention") {
    return {
      icon: "bg-chart-3/15 text-chart-3",
      progress: "bg-chart-3/15 [&_[data-slot=progress-indicator]]:bg-chart-3",
    };
  }
  if (tone === "chart") {
    return {
      icon: "bg-chart-4/15 text-chart-4",
      progress: "bg-chart-4/15 [&_[data-slot=progress-indicator]]:bg-chart-4",
    };
  }
  if (tone === "muted") {
    return {
      icon: "bg-muted text-muted-foreground",
      progress: "bg-muted [&_[data-slot=progress-indicator]]:bg-muted-foreground",
    };
  }
  return {
    icon: "bg-primary/12 text-primary",
    progress: "bg-primary/20 [&_[data-slot=progress-indicator]]:bg-primary",
  };
}

function buildAnalyticsOperatorBrief({ error, analyticsDaemonOnline, serviceHealth, recentErrors, failureRatePercent, queueDepth, activeWork }) {
  if (error) {
    return {
      title: "Analytics API is unavailable",
      detail: "The page could not read a fresh local analytics snapshot.",
      action: "Refresh after the local Autohand Squad server is restarted.",
      tone: "destructive",
      icon: AlertTriangle,
    };
  }
  if (!analyticsDaemonOnline) {
    return {
      title: "Analytics collector is not running",
      detail: "The page is using the web-server fallback, so the main daemon is visible but collector-level metrics are missing.",
      action: "Start the analytics collector or restart the launcher so service metrics come from the dedicated analytics process.",
      tone: "attention",
      icon: Gauge,
    };
  }
  if (recentErrors.length) {
    return {
      title: "Upstream endpoints need attention",
      detail: `${recentErrors.length} recent failure signals were recorded from the runtime.`,
      action: "Check the failing endpoint family before trusting release, ping, or feature-flag telemetry.",
      tone: "destructive",
      icon: ShieldAlert,
    };
  }
  if (failureRatePercent > 0) {
    return {
      title: "Run failures are present",
      detail: `${failureRatePercent}% of completed-or-failed runs ended in failure.`,
      action: "Open the failure list and inspect the most recent run before scheduling more automated work.",
      tone: "destructive",
      icon: AlertTriangle,
    };
  }
  if (queueDepth > 3 || activeWork > 3) {
    return {
      title: "Queue pressure is building",
      detail: `${queueDepth} queued jobs and ${activeWork} active work items are visible.`,
      action: "Watch queue throughput and add capacity before starting another large batch.",
      tone: "attention",
      icon: LayoutList,
    };
  }
  if (serviceHealth < 100) {
    return {
      title: "Partially healthy",
      detail: "Some local services are reporting, but not every expected process is online.",
      action: "Use the service table to identify which process is missing before relying on the dashboard.",
      tone: "attention",
      icon: ShieldAlert,
    };
  }
  return {
    title: "Healthy and quiet",
    detail: "Core services are online with no recent failures or queue pressure.",
    action: "Keep watching freshness and failure signals while the squad handles new work.",
    tone: "primary",
    icon: ShieldCheck,
  };
}

function analyticsChartColorKey(index) {
  return ANALYTICS_CHART_COLOR_KEYS[index % ANALYTICS_CHART_COLOR_KEYS.length];
}

function analyticsSignalRows(timestamps, locale) {
  return [
    { label: "Device registration", value: timestamps.lastDeviceRegistrationAt, icon: UserRound },
    { label: "Daemon ping", value: timestamps.lastPingAt, icon: Activity },
    { label: "Feature flags", value: timestamps.lastFeatureFlagCheckAt, icon: SlidersHorizontal },
    { label: "Telemetry flush", value: timestamps.lastTelemetryFlushAt, icon: Upload },
    { label: "Sync", value: timestamps.lastSyncAt, icon: RefreshCw },
    { label: "Update check", value: timestamps.lastUpdateCheckAt, icon: Clock3 },
  ].map((row) => ({
    ...row,
    display: formatAnalyticsTimestamp(row.value, locale),
    freshness: analyticsFreshness(row.value),
  }));
}

function analyticsFreshness(value) {
  const date = parseAnalyticsDate(value);
  if (!date) return { label: "Missing", tone: "muted" };
  const ageMs = Math.max(0, Date.now() - date.getTime());
  if (ageMs <= 3 * 60 * 1000) return { label: "Live", tone: "primary" };
  if (ageMs <= 15 * 60 * 1000) return { label: "Recent", tone: "chart" };
  return { label: "Stale", tone: "attention" };
}

function analyticsEventLabel(value) {
  return String(value || "unknown")
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function analyticsFailureKind(message) {
  const httpMatch = String(message || "").match(/HTTP\s+(\d+)/i);
  if (httpMatch) return `HTTP ${httpMatch[1]}`;
  return "Failure";
}

function truncateAnalyticsLabel(value, length = 18) {
  const text = String(value || "");
  if (text.length <= length) return text;
  return `${text.slice(0, Math.max(0, length - 1))}...`;
}

function analyticsServiceEndpoint(record) {
  if (record?.url) return record.url;
  if (record?.host && record?.port) return `${record.host}:${record.port}`;
  if (record?.pid) return `pid ${record.pid}`;
  return "not recorded";
}

function clampPercent(value) {
  const numericValue = Number(value) || 0;
  return Math.max(0, Math.min(100, numericValue));
}

function formatAnalyticsNumber(value, locale) {
  return formatLocalizedNumber(Number(value) || 0, locale);
}

function formatAnalyticsPercent(value) {
  const numericValue = Number(value) || 0;
  return `${Math.round(numericValue * 100)}%`;
}

function parseAnalyticsDate(value) {
  if (!value) return null;
  const text = String(value);
  const unixMatch = text.match(/^unix-ms:(\d+)$/);
  const date = unixMatch ? new Date(Number(unixMatch[1])) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatAnalyticsTimestamp(value, locale) {
  if (!value) return "";
  const date = parseAnalyticsDate(value);
  if (!date) return String(value);
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
    <div className={cn("min-w-0 rounded-md py-1", active && "text-foreground")}>
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
          <SelectTrigger className="h-10 w-full min-w-0 justify-between" aria-label={`${title} ${copy.themePresets}`}>
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
      {preset.swatches.map((color, index) => (
        <span
          key={`${preset.id}-${index}-${color}`}
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
