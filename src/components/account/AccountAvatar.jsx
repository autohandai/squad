import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** The same signed-in identity in navigation, account details and messages. */
export function AccountAvatar({ profile, className }) {
  return (
    <Avatar data-testid="account-avatar" className={cn("size-9 rounded-md bg-muted", className)}>
      {profile?.avatar ? <AvatarImage src={profile.avatar} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback className="rounded-md bg-muted text-sm font-semibold">
        {profile?.initials || "?"}
      </AvatarFallback>
    </Avatar>
  );
}
