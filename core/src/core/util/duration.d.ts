interface LabelSet {
  days: string
  hours: string
  minutes: string
  seconds: string
  milliseconds: string
}

interface DurationOptions {
  labels: LabelSet
  includeMilliseconds: boolean
  removeZeroes: boolean
  template: string
  minimal: boolean
}

interface DurationInstance {
  days: number
  hours: number
  minutes: number
  seconds: number
  milliseconds: number
}

export default interface Duration {
  (ms: number, options: DurationOptions): string

  parse: (ms: number) => DurationInstance

  day: number
  hour: number
  minute: number
  second: number
}
