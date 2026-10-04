"""Physical constants (REAL). Units: km, s, W, K unless noted."""

MU_EARTH = 398600.4418  # km^3/s^2 (WGS84 / EGM96)
R_EARTH = 6378.137  # km, WGS84 equatorial radius
F_EARTH = 1.0 / 298.257223563  # WGS84 flattening
E2_EARTH = F_EARTH * (2.0 - F_EARTH)  # first eccentricity squared
J2 = 1.08262668e-3  # EGM96 un-normalised zonal coefficient
OMEGA_EARTH = 7.292115146706979e-5  # rad/s, sidereal rotation rate

R_SUN = 696000.0  # km, nominal solar radius
AU = 149597870.7  # km, IAU 2012
SOLAR_CONSTANT = 1361.0  # W/m^2, total solar irradiance at 1 AU (Kopp & Lean 2011)

SIGMA_SB = 5.670374419e-8  # W m^-2 K^-4 (CODATA 2018)
EARTH_OLR = 237.0  # W/m^2, global-mean outgoing longwave radiation (approximate)
C_KM_S = 299792.458  # km/s

SECONDS_PER_DAY = 86400.0
TROPICAL_YEAR_DAYS = 365.2422
SSO_NODAL_RATE = 2.0 * 3.141592653589793 / (TROPICAL_YEAR_DAYS * SECONDS_PER_DAY)  # rad/s

ZERO_C_K = 273.15
