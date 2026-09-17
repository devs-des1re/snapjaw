FROM python:3.13-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Tk for turtle/tkinter, Xvfb for the virtual display they draw into, and DejaVu
# so text renders. ImageMagick is the fallback capture path; the fast path
# grabs the display in-process with Pillow (see snapjaw-exec.py).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3-tk \
      tk \
      xvfb \
      x11-utils \
      imagemagick \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "pillow==11.3.0"

COPY snapjaw-exec.py /usr/local/bin/snapjaw-exec
RUN chmod 0755 /usr/local/bin/snapjaw-exec

# Unprivileged. The container is run with --read-only, so the only writable
# path is the /tmp tmpfs the helper uses for its scratch directory.
RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin sandbox

USER sandbox
ENV HOME=/tmp
WORKDIR /tmp

# The pool keeps containers alive and drives them with `docker exec`.
CMD ["sleep", "infinity"]
