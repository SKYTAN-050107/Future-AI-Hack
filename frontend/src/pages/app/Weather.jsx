import BackButton from '../../components/navigation/BackButton'
import SectionHeader from '../../components/ui/SectionHeader'

const sevenDayForecast = [
  { day: 'Today', condition: 'Passing Rain', rainChance: 68, wind: '12 km/h SW', sprayWindow: 'Delay spraying', safe: false },
  { day: 'Tomorrow', condition: 'Cloudy', rainChance: 35, wind: '10 km/h S', sprayWindow: 'After 3:00 PM', safe: true },
  { day: 'Thursday', condition: 'Sunny Intervals', rainChance: 18, wind: '8 km/h SE', sprayWindow: '10:00 AM - 4:00 PM', safe: true },
  { day: 'Friday', condition: 'Heavy Showers', rainChance: 74, wind: '16 km/h SW', sprayWindow: 'Delay spraying', safe: false },
  { day: 'Saturday', condition: 'Cloudy', rainChance: 32, wind: '11 km/h W', sprayWindow: 'After 2:30 PM', safe: true },
  { day: 'Sunday', condition: 'Light Rain', rainChance: 44, wind: '13 km/h NW', sprayWindow: 'Before 10:00 AM', safe: true },
  { day: 'Monday', condition: 'Partly Cloudy', rainChance: 22, wind: '9 km/h E', sprayWindow: '9:30 AM - 3:30 PM', safe: true },
]

export default function Weather() {
  return (
    <section className="pg-page">
      <SectionHeader
        title="7-Day Climate View"
        align="left"
        leadingAction={<BackButton fallback="/app" label="Back to dashboard" />}
      />

      {sevenDayForecast.map((entry) => (
        <article key={entry.day} className="pg-card">
          <h2>{entry.day}</h2>
          <p>{entry.condition} - Rain chance {entry.rainChance}% - Wind {entry.wind}</p>
          <p>
            Spray window: {entry.sprayWindow}{' '}
            <strong style={{ color: entry.safe ? 'var(--primary)' : 'var(--danger)' }}>
              {entry.safe ? 'CLEAR' : 'DELAY'}
            </strong>
          </p>
        </article>
      ))}
    </section>
  )
}
