// The OS owns the lock lifetime. Parent death closes stdin, including after a crash.
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>

int main(int argc, char **argv) {
    if (argc != 2) return 64;
    int fd = open(argv[1], O_RDWR | O_CREAT, 0600);
    if (fd < 0) return 74;
    if (flock(fd, LOCK_EX | LOCK_NB) != 0) { close(fd); return 73; }
    fchmod(fd, 0600);
    // Contents are diagnostic only. A stale PID never controls lock ownership.
    ftruncate(fd, 0);
    dprintf(fd, "%ld\n", (long)getppid());
    puts("ready"); fflush(stdout);
    char buffer[64];
    for (;;) {
        ssize_t n = read(STDIN_FILENO, buffer, sizeof(buffer));
        if (n == 0 || (n < 0 && errno != EINTR)) break;
    }
    close(fd);
    return 0;
}
