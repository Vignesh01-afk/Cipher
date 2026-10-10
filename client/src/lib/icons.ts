import type { ComponentType } from 'react';
import type { IconProps } from '@phosphor-icons/react';

/**
 * One shared component type for icons.
 *
 * Several screens pass an icon around as a value (stat cards, empty states,
 * note actions, audit entries) instead of rendering it inline, so they need a
 * type for "a component that draws an icon". Phosphor exports its own props
 * type, so this alias stays honest about what the components accept.
 */
export type IconComponent = ComponentType<IconProps>;
