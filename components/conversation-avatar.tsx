"use client";

import { UsersRound } from "lucide-react";
import { Avatar } from "./avatar";

interface Props {
  avatarUrl: string | null;
  displayName: string;
  size?: number;
  isGroup?: boolean;
  online?: boolean;
}

export function ConversationAvatar({
  avatarUrl,
  displayName,
  size = 40,
  isGroup = false,
  online = false,
}: Props) {
  const hasGroupPhoto =
    Boolean(avatarUrl) && !avatarUrl?.includes("api.dicebear.com/9.x/initials");

  if (isGroup && !hasGroupPhoto) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          backgroundColor: "#d9f3df",
          color: "#248447",
        }}
        role="img"
        aria-label={`${displayName} group photo`}
      >
        <UsersRound size={size * 0.52} strokeWidth={1.8} aria-hidden />
      </span>
    );
  }

  return (
    <Avatar
      subject={{ avatar_url: avatarUrl, display_name: displayName }}
      size={size}
      online={online}
    />
  );
}
