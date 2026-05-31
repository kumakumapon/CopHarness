import { type SkillDefinition } from '../skill';

/**
 * Weather skill using the Open-Meteo API (free, no API key required).
 * Geocoding is performed via the Open-Meteo Geocoding API.
 */

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

interface GeoResponse {
  results?: GeoResult[];
}

interface WeatherResponse {
  current?: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
    relative_humidity_2m: number;
    precipitation: number;
  };
  current_units?: {
    temperature_2m: string;
    wind_speed_10m: string;
  };
}

function describeWeatherCode(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 49) return 'Foggy';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 84) return 'Rain showers';
  if (code <= 94) return 'Thunderstorm';
  return 'Hail / Thunderstorm';
}

export const getWeather: SkillDefinition = {
  name: 'getWeather',
  description:
    'Returns the current weather for a city or location using the Open-Meteo API (no API key required). ' +
    'Includes temperature, apparent temperature, humidity, wind speed, precipitation, and condition.',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or location, e.g. "Tokyo", "London", "New York".',
      },
    },
    required: ['location'],
  },
  category: 'web',
  riskLevel: 'low',
  handler: async (args) => {
    const location = String(args.location ?? '').trim();
    if (!location) return { content: 'Error: location is required', isError: true };

    try {
      // Step 1: Geocode the location
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) {
        return { content: `Error: geocoding request failed (${geoRes.status})`, isError: true };
      }
      const geoData = await geoRes.json() as GeoResponse;
      if (!geoData.results || geoData.results.length === 0) {
        return { content: `Error: could not find location "${location}"`, isError: true };
      }
      const geo = geoData.results[0];

      // Step 2: Fetch weather
      const weatherUrl =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${geo.latitude}&longitude=${geo.longitude}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m` +
        `&wind_speed_unit=kmh&timezone=auto`;
      const weatherRes = await fetch(weatherUrl);
      if (!weatherRes.ok) {
        return { content: `Error: weather request failed (${weatherRes.status})`, isError: true };
      }
      const weather = await weatherRes.json() as WeatherResponse;
      const c = weather.current;
      if (!c) return { content: 'Error: no current weather data returned', isError: true };

      const locLabel = [geo.name, geo.admin1, geo.country].filter(Boolean).join(', ');
      const tempUnit = weather.current_units?.temperature_2m ?? '°C';
      const windUnit = weather.current_units?.wind_speed_10m ?? 'km/h';
      const lines = [
        `📍 ${locLabel}`,
        `🕐 ${c.time}`,
        `🌡️ Temperature: ${c.temperature_2m}${tempUnit} (feels like ${c.apparent_temperature}${tempUnit})`,
        `💧 Humidity: ${c.relative_humidity_2m}%`,
        `💨 Wind: ${c.wind_speed_10m} ${windUnit}`,
        `🌧️ Precipitation: ${c.precipitation} mm`,
        `⛅ Condition: ${describeWeatherCode(c.weather_code)} (code ${c.weather_code})`,
      ];
      return { content: lines.join('\n') };
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
