import { createClient } from '@supabase/supabase-js'

// Las dos claves se leen del archivo .env (y en Vercel, de sus variables de entorno)
const url = import.meta.env.VITE_SUPABASE_URL
const clave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = url && clave ? createClient(url, clave) : null

// Trae las estaciones de la tabla "puntos"
export async function obtenerEstaciones() {
  if (!supabase) {
    throw new Error('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en el archivo .env')
  }

  const { data, error } = await supabase
    .from('puntos')
    .select('id, nombre, bandera, partido, localidad, direccion, latitud, longitud, precio_super, precio_premium, fecha, valor, categoria')

  if (error) throw new Error(error.message)

  // Etapa 4 del TP: comprobar que los datos llegan bien
  console.log(`Supabase devolvió ${data.length} estaciones`, data)

  return data.map((e) => ({
    ...e,
    latitud: Number(e.latitud),
    longitud: Number(e.longitud),
    precio_super: e.precio_super == null ? null : Number(e.precio_super),
    precio_premium: e.precio_premium == null ? null : Number(e.precio_premium),
  }))
}