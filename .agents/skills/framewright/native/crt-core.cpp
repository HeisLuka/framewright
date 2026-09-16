#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>
#include <thread>
#include <vector>

static uint32_t hash_parts(const std::vector<std::string>& parts) {
  uint32_t h = 2166136261u;
  for (const auto& part : parts) {
    const std::string s = part + "|";
    for (unsigned char ch : s) {
      h ^= static_cast<uint32_t>(ch);
      h = h * 16777619u;
    }
  }
  h ^= h >> 13;
  h = h * 0x5bd1e995u;
  h ^= h >> 15;
  return h;
}

static double first_sfc32(uint32_t seed) {
  uint32_t a = seed;
  uint32_t b = 0x9e3779b9u;
  uint32_t c = 0x6a09e667u;
  uint32_t d = 0xbb67ae85u;
  auto next = [&]() -> double {
    uint32_t t = a + b;
    a = b ^ (b >> 9);
    b = c + (c << 3);
    c = (c << 21) | (c >> 11);
    d = d + 1u;
    t = t + d;
    c = c + t;
    return static_cast<double>(t) / 4294967296.0;
  };
  for (int i = 0; i < 12; ++i) next();
  return next();
}

static bool read_exact(std::istream& in, char* dst, size_t n, bool allow_clean_eof = false) {
  size_t done = 0;
  while (done < n) {
    in.read(dst + done, static_cast<std::streamsize>(n - done));
    const auto got = static_cast<size_t>(in.gcount());
    done += got;
    if (done == n) return true;
    if (in.eof()) return allow_clean_eof && done == 0;
    if (!in.good() && got == 0) return false;
  }
  return true;
}

static uint32_t read_u32_le(const unsigned char* p) {
  return static_cast<uint32_t>(p[0])
    | (static_cast<uint32_t>(p[1]) << 8)
    | (static_cast<uint32_t>(p[2]) << 16)
    | (static_cast<uint32_t>(p[3]) << 24);
}

static double read_f64_le(const unsigned char* p) {
  uint64_t bits = 0;
  for (int i = 0; i < 8; ++i) bits |= static_cast<uint64_t>(p[i]) << (8 * i);
  double value;
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}

static uint8_t to_uint8_clamp(double x) {
  if (!(x > 0.0)) return 0;
  if (x >= 255.0) return 255;
  const double f = std::floor(x);
  const double diff = x - f;
  if (diff < 0.5) return static_cast<uint8_t>(f);
  if (diff > 0.5) return static_cast<uint8_t>(f + 1.0);
  const auto fi = static_cast<uint32_t>(f);
  return static_cast<uint8_t>((fi & 1u) ? fi + 1u : fi);
}

struct Params {
  uint32_t width;
  uint32_t height;
  uint32_t frame;
  uint32_t seed;
  double barrel;
  double ca;
  double caX;
  double vig;
  double gain;
  double flick;
  double grain;
  double grainMultiplier;
  double wobble;
  bool skip;
  uint32_t rgbaLen;
};

static std::vector<uint8_t> process_frame(const std::vector<uint8_t>& src, const Params& p) {
  if (p.skip) return src;
  const int W = static_cast<int>(p.width);
  const int H = static_cast<int>(p.height);
  const int W1 = W - 1;
  const int H1 = H - 1;
  const double cx = (W - 1) / 2.0;
  const double cy = (H - 1) / 2.0;
  const double norm = 1.0 / (1.0 + p.barrel);
  const double caXPx = p.caX * W / 1920.0;

  std::vector<float> map(static_cast<size_t>(W) * H * 2);
  for (int y = 0; y < H; ++y) {
    const double ny = (y - cy) / cy;
    for (int x = 0; x < W; ++x) {
      const double nx = (x - cx) / cx;
      const double d = (1.0 + p.barrel * (nx * nx + ny * ny)) * norm;
      const size_t i = (static_cast<size_t>(y) * W + x) * 2;
      map[i] = static_cast<float>(nx * d * cx + cx);
      map[i + 1] = static_cast<float>(ny * d * cy + cy);
    }
  }

  const int slP = std::max(2, static_cast<int>(std::lround(H / 360.0)));
  std::vector<float> slT(slP);
  for (int i = 0; i < slP; ++i) {
    slT[i] = static_cast<float>(0.58 + 0.42 * std::pow(std::sin(M_PI * (i + 0.5) / slP), 1.2));
  }

  const uint32_t postHash = hash_parts({std::to_string(p.seed), "post", std::to_string(p.frame)});
  const double rand = first_sfc32(postHash);
  const double flick = p.flick * (1.0 + (rand - 0.5) * 0.045 + 0.015 * std::sin(p.frame * 0.7));
  const double grain = p.grain * p.grainMultiplier;
  const double wobblePixels = p.wobble * W;

  std::vector<double> grainNoise(static_cast<size_t>(W) * H);
  uint32_t z = hash_parts({std::to_string(p.seed), "grain", std::to_string(p.frame)});
  for (size_t i = 0; i < grainNoise.size(); ++i) {
    z = z * 1664525u + 1013904223u;
    grainNoise[i] = ((static_cast<double>(z >> 24) / 255.0) - 0.5) * grain;
  }

  std::vector<uint8_t> out(static_cast<size_t>(W) * H * 4);
  auto render_rows = [&](int y0, int y1) {
    for (int y = y0; y < y1; ++y) {
      const double ny = (y - cy) / cy;
      const double sl = slT[y % slP];
      const double wob = wobblePixels != 0.0
        ? std::sin(y * 0.05 + p.frame * 0.9) * wobblePixels
          * (0.5 + 0.5 * std::sin(y * 0.0031 + p.frame * 0.21))
        : 0.0;
      for (int x = 0; x < W; ++x) {
        const size_t i = static_cast<size_t>(y) * W + x;
        const size_t o4 = i * 4;
        const size_t mi = i * 2;
        const double px = static_cast<double>(map[mi]) + wob;
        const double py = static_cast<double>(map[mi + 1]);
        const double nx = (x - cx) / cx;
        const double r2 = nx * nx + ny * ny;
        double r = 0.0, g = 0.0, b = 0.0;

        if (px >= 0.0 && px <= W1 && py >= 0.0 && py <= H1) {
          const int x0 = static_cast<int>(px), yb0 = static_cast<int>(py);
          const double fx = px - x0, fy = py - yb0;
          const int x1 = x0 < W1 ? x0 + 1 : x0;
          const int yb1 = yb0 < H1 ? yb0 + 1 : yb0;
          const size_t a = (static_cast<size_t>(yb0) * W + x0) * 4;
          const size_t bq = (static_cast<size_t>(yb0) * W + x1) * 4;
          const size_t c = (static_cast<size_t>(yb1) * W + x0) * 4;
          const size_t d = (static_cast<size_t>(yb1) * W + x1) * 4;
          g = (src[a + 1] * (1.0 - fx) + src[bq + 1] * fx) * (1.0 - fy)
            + (src[c + 1] * (1.0 - fx) + src[d + 1] * fx) * fy;
        }

        const double rx = (px - cx) * (1.0 + p.ca) + cx + caXPx;
        const double ry = (py - cy) * (1.0 + p.ca) + cy;
        if (rx >= 0.0 && rx <= W1 && ry >= 0.0 && ry <= H1) {
          const int x0 = static_cast<int>(rx), yb0 = static_cast<int>(ry);
          const double fx = rx - x0, fy = ry - yb0;
          const int x1 = x0 < W1 ? x0 + 1 : x0;
          const int yb1 = yb0 < H1 ? yb0 + 1 : yb0;
          const size_t a = (static_cast<size_t>(yb0) * W + x0) * 4;
          const size_t bq = (static_cast<size_t>(yb0) * W + x1) * 4;
          const size_t c = (static_cast<size_t>(yb1) * W + x0) * 4;
          const size_t d = (static_cast<size_t>(yb1) * W + x1) * 4;
          r = (src[a] * (1.0 - fx) + src[bq] * fx) * (1.0 - fy)
            + (src[c] * (1.0 - fx) + src[d] * fx) * fy;
        }

        const double bx = (px - cx) * (1.0 - p.ca) + cx - caXPx;
        const double by = (py - cy) * (1.0 - p.ca) + cy;
        if (bx >= 0.0 && bx <= W1 && by >= 0.0 && by <= H1) {
          const int x0 = static_cast<int>(bx), yb0 = static_cast<int>(by);
          const double fx = bx - x0, fy = by - yb0;
          const int x1 = x0 < W1 ? x0 + 1 : x0;
          const int yb1 = yb0 < H1 ? yb0 + 1 : yb0;
          const size_t a = (static_cast<size_t>(yb0) * W + x0) * 4;
          const size_t bq = (static_cast<size_t>(yb0) * W + x1) * 4;
          const size_t c = (static_cast<size_t>(yb1) * W + x0) * 4;
          const size_t d = (static_cast<size_t>(yb1) * W + x1) * 4;
          b = (src[a + 2] * (1.0 - fx) + src[bq + 2] * fx) * (1.0 - fy)
            + (src[c + 2] * (1.0 - fx) + src[d + 2] * fx) * fy;
        }

        const double v = (1.0 - p.vig * std::pow(r2 * 0.5, 1.4)) * sl * flick * p.gain;
        const double gn = grainNoise[i];
        r = r * v + gn;
        g = g * v + gn;
        b = b * v + gn;
        out[o4] = to_uint8_clamp(r < 0.0 ? 0.0 : r > 255.0 ? 255.0 : r);
        out[o4 + 1] = to_uint8_clamp(g < 0.0 ? 0.0 : g > 255.0 ? 255.0 : g);
        out[o4 + 2] = to_uint8_clamp(b < 0.0 ? 0.0 : b > 255.0 ? 255.0 : b);
        out[o4 + 3] = 255;
      }
    }
  };

  const unsigned hw = std::max(1u, std::thread::hardware_concurrency());
  const unsigned threads = std::min<unsigned>(hw, std::max(1, H / 32));
  if (threads <= 1) {
    render_rows(0, H);
  } else {
    std::vector<std::thread> workers;
    workers.reserve(threads);
    for (unsigned t = 0; t < threads; ++t) {
      const int y0 = static_cast<int>((static_cast<uint64_t>(H) * t) / threads);
      const int y1 = static_cast<int>((static_cast<uint64_t>(H) * (t + 1)) / threads);
      workers.emplace_back(render_rows, y0, y1);
    }
    for (auto& worker : workers) worker.join();
  }
  return out;
}

int main() {
  std::ios::sync_with_stdio(false);
  std::cin.tie(nullptr);
  std::cout.tie(nullptr);

  constexpr size_t HEADER = 97;
  std::array<unsigned char, HEADER> header{};
  while (true) {
    std::cin.read(reinterpret_cast<char*>(header.data()), HEADER);
    const auto got = static_cast<size_t>(std::cin.gcount());
    if (got == 0 && std::cin.eof()) return 0;
    if (got != HEADER) {
      std::cerr << "short CRT header: " << got << "\n";
      return 2;
    }
    if (!(header[0] == 'F' && header[1] == 'W' && header[2] == 'C' && header[3] == '1')) {
      std::cerr << "bad CRT header magic\n";
      return 3;
    }
    Params p{};
    size_t off = 4;
    p.width = read_u32_le(header.data() + off); off += 4;
    p.height = read_u32_le(header.data() + off); off += 4;
    p.frame = read_u32_le(header.data() + off); off += 4;
    p.seed = read_u32_le(header.data() + off); off += 4;
    p.barrel = read_f64_le(header.data() + off); off += 8;
    p.ca = read_f64_le(header.data() + off); off += 8;
    p.caX = read_f64_le(header.data() + off); off += 8;
    p.vig = read_f64_le(header.data() + off); off += 8;
    p.gain = read_f64_le(header.data() + off); off += 8;
    p.flick = read_f64_le(header.data() + off); off += 8;
    p.grain = read_f64_le(header.data() + off); off += 8;
    p.grainMultiplier = read_f64_le(header.data() + off); off += 8;
    p.wobble = read_f64_le(header.data() + off); off += 8;
    p.skip = header[off++] != 0;
    p.rgbaLen = read_u32_le(header.data() + off); off += 4;

    const uint64_t expected = static_cast<uint64_t>(p.width) * p.height * 4u;
    if (p.width == 0 || p.height == 0 || p.rgbaLen != expected || expected > (1ull << 31)) {
      std::cerr << "invalid CRT frame dimensions or byte length\n";
      return 4;
    }
    std::vector<uint8_t> rgba(p.rgbaLen);
    if (!read_exact(std::cin, reinterpret_cast<char*>(rgba.data()), rgba.size())) {
      std::cerr << "short CRT frame body\n";
      return 5;
    }
    auto out = process_frame(rgba, p);
    std::cout.write(reinterpret_cast<const char*>(out.data()), static_cast<std::streamsize>(out.size()));
    std::cout.flush();
    if (!std::cout.good()) return 6;
  }
}
