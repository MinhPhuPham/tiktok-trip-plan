import type { IconName } from "./IconSprite";

interface IconProps {
  name: IconName;
  className?: string;
}

/** Decorative icon from the sprite; give the control its own accessible name. */
export function Icon({ name, className = "icon" }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}
