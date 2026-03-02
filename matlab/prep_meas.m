function out = prep_meas(X)

x = 20:40:300; % rank offsets (from 1 to 5) along X: 20, 60, 100, 140, 180
y = -20:-40:-300; % file offsets (from 'a' to 'e') along Y: -20, -60, ... , -220
[files, ranks] = meshgrid(y, x);
heights = zeros(size(ranks));
boardOffsets = [ranks(:), files(:), heights(:)];
originOffset = [76,165,25];

if ~isequal(size(X), [size(boardOffsets, 1), 7])
  error('Invalid dimensions');
end

out.Qcmd = X(:, 1:4);
out.Xmeas = X(:, 5:7) + boardOffsets + originOffset;

end
