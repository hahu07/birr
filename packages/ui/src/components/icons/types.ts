import { SVGProps } from "react";

/**
 * Shared prop shape for every hand-authored icon in this directory.
 * Consumers size/color icons purely through className (e.g. `h-4 w-4
 * text-primary-700`) — no icon carries its own fixed dimensions or color
 * so it drops cleanly into nav items, buttons, or stat tiles alike.
 */
export type IconProps = SVGProps<SVGSVGElement>;
