export default function SkeletonBlock({ width = '100%', height = 12, rounded = 8 }) {
  return (
    <span
      className="pg-skeleton"
      style={{
        width,
        height,
        borderRadius: rounded,
      }}
      aria-hidden="true"
    />
  )
}
