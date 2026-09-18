FROM python:3.13-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

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

# Put on the program's PYTHONPATH only: that is how the program gets input() and loses tkinter.
COPY sitecustomize.py /opt/snapjaw/sitecustomize.py

# Unprivileged; --read-only leaves the /tmp tmpfs as the only writable path.
RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin sandbox

USER sandbox
ENV HOME=/tmp
WORKDIR /tmp

# The pool keeps containers alive and drives them with `docker exec`.
CMD ["sleep", "infinity"]
