/**
 * Monochrome UI icons — stroke style, inherit color via currentColor.
 * Use with className="pg-icon" from parent for size.
 */

const stroke = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function Svg({ children, className, ...rest }) {
  return (
    <svg {...stroke} className={className} aria-hidden="true" {...rest}>
      {children}
    </svg>
  )
}

export function IconHome({ className }) {
  return (
    <Svg className={className}>
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z" />
    </Svg>
  )
}

export function IconMap({ className }) {
  return (
    <Svg className={className}>
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </Svg>
  )
}

export function IconCamera({ className }) {
  return (
    <Svg className={className}>
      <path d="M4 8h3l2-2h6l2 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" />
      <circle cx="12" cy="14" r="3.5" />
    </Svg>
  )
}

export function IconClock({ className }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2v5.2l3.4 2" />
    </Svg>
  )
}

export function IconSparkles({ className }) {
  return (
    <Svg className={className}>
      <path d="M12 3.2l1.4 3.4L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4L12 3.2z" />
      <path d="M18.5 13.7l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" />
      <path d="M5.5 14.2l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7.7-1.7z" />
    </Svg>
  )
}

export function IconAgent({ className }) {
  return (
    <Svg className={className}>
      <path d="M4 7.5a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 7.5V14a2.5 2.5 0 0 1-2.5 2.5H10l-4 3v-3h-.5A2.5 2.5 0 0 1 3 14V7.5z" />
      <path d="M12 8.2v3.6M10.2 10h3.6" />
      <path d="M16 8.3h.01M16 11.7h.01" />
    </Svg>
  )
}

export function IconList({ className }) {
  return (
    <Svg className={className}>
      <path d="M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01" />
    </Svg>
  )
}

export function IconChevronRight({ className }) {
  return (
    <Svg className={className}>
      <path d="M9 5l7 7-7 7" />
    </Svg>
  )
}

export function IconPlus({ className }) {
  return (
    <Svg className={className}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function IconBug({ className }) {
  return (
    <Svg className={className}>
      <path d="M7.5 9.5h9M6.5 13h11M9.5 6.2h5" />
      <path d="M9 8.4V6.2a3 3 0 0 1 6 0v2.2" />
      <path d="M8.2 18a3.8 3.8 0 0 1-2.2-3.4V10h12v4.6a3.8 3.8 0 0 1-2.2 3.4" />
      <path d="M4.8 8l2 1.2M19.2 8l-2 1.2M4.8 16l2-1.2M19.2 16l-2-1.2" />
    </Svg>
  )
}

export function IconShieldLeaf({ className }) {
  return (
    <Svg className={className}>
      <path d="M12 3l7 3v5.1c0 4.5-2.7 7.7-7 9.9-4.3-2.2-7-5.4-7-9.9V6l7-3z" />
      <path d="M9.2 13.6c1.8-2.3 4.7-3.2 7.2-3.3" />
      <path d="M11.2 15.7c.2-2.4.9-4.3 2.7-6" />
    </Svg>
  )
}

export function IconSprout({ className }) {
  return (
    <Svg className={className}>
      <path d="M12 20v-7" />
      <path d="M12 13c0-3.5 2.7-6.5 6.2-6.8-.1 3.8-2.4 6.6-6.2 6.8z" />
      <path d="M12 15c-3.8-.2-6.1-3-6.2-6.8C9.3 8.5 12 11.5 12 15z" />
      <path d="M9 21h6" />
    </Svg>
  )
}

export function IconUser({ className }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20v-1a7 7 0 0 1 14 0v1" />
    </Svg>
  )
}

export function IconDownload({ className }) {
  return (
    <Svg className={className}>
      <path d="M12 4v11" />
      <path d="M8 12l4 4 4-4" />
      <path d="M5 20h14" />
    </Svg>
  )
}

export function IconMicroscope({ className }) {
  return (
    <Svg className={className}>
      <path d="M6 18h12M9 18V9a3 3 0 0 1 6 0v9" />
      <path d="M8 14h8" />
      <circle cx="12" cy="6" r="2" />
    </Svg>
  )
}

export function IconChart({ className }) {
  return (
    <Svg className={className}>
      <path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6" />
    </Svg>
  )
}

export function IconCloud({ className }) {
  return (
    <Svg className={className}>
      <path d="M7 18h9a4 4 0 0 0 0-8 1 1 0 0 0-1-1 5 5 0 0 0-9.7 1.5A3 3 0 0 0 7 18z" />
    </Svg>
  )
}

export function IconClipboard({ className }) {
  return (
    <Svg className={className}>
      <path d="M9 4h6a1 1 0 0 1 1 1v16H8V5a1 1 0 0 1 1-1z" />
      <path d="M10 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
      <path d="M10 12h4M10 16h4" />
    </Svg>
  )
}

export function IconArrowLeft({ className }) {
  return (
    <Svg className={className}>
      <path d="M15 5l-7 7 7 7" />
      <path d="M8 12h12" />
    </Svg>
  )
}

export function IconImage({ className }) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.2" />
      <path d="M21 16l-5-5-5 5-2-2-6 6" />
    </Svg>
  )
}

export function IconSend({ className }) {
  return (
    <Svg className={className}>
      <path d="M3 12L21 4l-7 16-3-6-8-2z" />
      <path d="M11 14l10-10" />
    </Svg>
  )
}

export function IconSun({ className }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3" />
    </Svg>
  )
}

export function IconMoon({ className }) {
  return (
    <Svg className={className}>
      <path d="M20 14.2A8 8 0 1 1 9.8 4a6.5 6.5 0 0 0 10.2 10.2z" />
    </Svg>
  )
}

export function IconEye({ className }) {
  return (
    <Svg className={className}>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

export function IconEyeOff({ className }) {
  return (
    <Svg className={className}>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.9 5.1A11.8 11.8 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-3.7 4.3" />
      <path d="M6.3 6.4A18.6 18.6 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 3-.4" />
    </Svg>
  )
}

export function IconGoogle({ className }) {
  return (
    <Svg className={className}>
      <path d="M21.8 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.5a4.8 4.8 0 0 1-2.1 3.2v2.7h3.4a10 10 0 0 0 3-7.8z" />
      <path d="M12 22c2.7 0 4.9-.9 6.5-2.4l-3.4-2.7c-.9.6-2 .9-3.1.9-2.4 0-4.5-1.6-5.2-3.9H3.2v2.8A10 10 0 0 0 12 22z" />
      <path d="M6.8 13.9A6 6 0 0 1 6.5 12c0-.7.1-1.3.3-1.9V7.3H3.2A10 10 0 0 0 2 12c0 1.6.4 3.1 1.2 4.5l3.6-2.6z" />
      <path d="M12 6.2c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 12 2 10 10 0 0 0 3.2 7.3l3.6 2.8c.7-2.3 2.8-3.9 5.2-3.9z" />
    </Svg>
  )
}

export function IconApple({ className }) {
  return (
    <Svg className={className}>
      <path d="M16.8 12.8c0-2.6 2.1-3.9 2.2-4-1.2-1.8-3.1-2-3.8-2-.2 0-2 .1-3.2 1.2-1-.8-2.6-1.2-3.2-1.2-2.7 0-5.4 2.2-5.4 6.2 0 1.2.2 2.5.7 3.8.6 1.7 2.7 5.8 4.9 5.7 1 0 1.7-.7 3-.7 1.2 0 1.9.7 3 .7 2.2 0 4.2-3.8 4.9-5.5-0.1 0-3.1-1.2-3.1-4.2z" />
      <path d="M14.9 5.5c.5-.6.9-1.6.8-2.5-.8.1-1.8.6-2.3 1.2-.5.6-.9 1.6-.8 2.4.9.1 1.8-.4 2.3-1.1z" />
    </Svg>
  )
}

export function IconPhone({ className }) {
  return (
    <Svg className={className}>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M10 5.5h4" />
      <circle cx="12" cy="18.5" r="0.8" fill="currentColor" stroke="none" />
    </Svg>
  )
}
