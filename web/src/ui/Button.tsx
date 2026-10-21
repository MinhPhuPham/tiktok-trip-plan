import type { ComponentProps, ReactNode } from "react";
import { classes } from "../lib/css";
import { Icon } from "./Icon";
import type { IconName } from "./IconSprite";

export type ButtonVariant = "default" | "primary" | "ghost";

export interface ButtonProps extends Omit<ComponentProps<"button">, "type"> {
  variant?: ButtonVariant;
  /** Toggle look (.is-on) for a pressed state; pair with aria-pressed when it is a toggle. */
  on?: boolean;
  icon?: IconName;
  type?: "button" | "submit";
  children?: ReactNode;
}

export function buttonClass(variant: ButtonVariant = "default", on = false, extra?: string): string {
  return classes("btn", variant !== "default" && variant, on && "is-on", extra);
}

export function Button({ variant, on, icon, type = "button", className, children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, on, className)} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}
